// 与后端 docs/API.md 契约对应的类型定义

export interface User {
  id: string;
  email: string;
  name: string;
  role: "STUDENT" | "TEACHER" | "ADMIN";
  targetUniversity?: string | null;
}

export interface AuthData {
  token: string;
  user: User;
}

export interface Question {
  id: string;
  subject: "TMUA" | "ESAT";
  paper?: string | null;
  topic: string;
  difficulty: number;
  type: "SINGLE_CHOICE" | "MULTIPLE_CHOICE" | "NUMERIC";
  stem: string;
  options: string[]; // 后端返回 JSON 字符串,统一在 api 层解析为数组
  answer?: string;
  solution?: string | null;
  source?: string | null;
  status: "DRAFT" | "PENDING_REVIEW" | "PUBLISHED" | "REJECTED" | "ARCHIVED";
  reviewNote?: string | null;
  reviewedAt?: string | null;
  createdAt?: string;
}

export interface QuestionList {
  list: Question[];
  total: number;
  page: number;
  pageSize: number;
}

export interface QuizQuestion {
  id: string;
  subject: string;
  paper?: string | null;
  topic: string;
  difficulty: number;
  type: string;
  stem: string;
  options: string[];
  source?: string | null;
}

export interface CreateSessionData {
  sessionId: string;
  mode: "PRACTICE" | "EXAM";
  durationMin?: number | null;
  questions: QuizQuestion[];
}

export interface GradeResult {
  score: number;
  total: number;
  correctCount: number;
  timedOut?: boolean;
  details: { questionId: string; selected: string | null; isCorrect: boolean }[];
}

export interface SessionSummary {
  id: string;
  mode: "PRACTICE" | "EXAM";
  score: number | null;
  total: number | null;
  correctCount: number | null;
  startedAt: string;
  submittedAt: string | null;
}

export interface SessionDetail {
  id: string;
  mode: string;
  durationMin?: number | null;
  score: number | null;
  total: number | null;
  correctCount: number | null;
  startedAt: string;
  submittedAt: string | null;
  details: {
    questionId: string;
    selected: string | null;
    isCorrect: boolean | null;
    timeSpent: number | null;
    options: string[];
    answer?: string;
    solution?: string | null;
    stem: string;
    topic: string;
  }[];
}

export interface WrongItem {
  questionId: string;
  topic: string;
  subject: string;
  difficulty: number;
  stem: string;
  answer?: string | null;
  solution?: string | null;
  wrongCount: number;
  mastered: boolean;
}

export interface StatsData {
  byTopic: { topic: string; attempts: number; correctRate: number }[];
  totalAnswered: number;
}

// ---- 试卷(含套题自动组卷) ----

/** 卷内题目的审核分布 */
export interface PaperStats {
  total: number;
  published: number;
  pending: number;
  rejected: number;
  draft: number;
  archived: number;
  /** 卷内引用的题目已被删除的数量 */
  missing: number;
}

export interface PaperRow {
  id: string;
  title: string;
  subject: string;
  mode: string;
  durationMin: number | null;
  questionCount: number;
  createdAt: string;
  /** 以下字段仅老师视角返回 */
  source?: string | null;
  /** MANUAL = 手动组卷;AUTO_SET = 套题录入自动成卷 */
  origin?: "MANUAL" | "AUTO_SET";
  /** DRAFT = 还有题没审完;READY = 全部通过,学生可作答;ARCHIVED = 已下架 */
  status?: "DRAFT" | "READY" | "ARCHIVED";
  stats?: PaperStats;
}

export interface PaperManageQuestion {
  id: string;
  index: number;
  missing: boolean;
  subject?: string;
  paper?: string | null;
  topic?: string;
  difficulty?: number;
  type?: string;
  stem?: string;
  options?: string[];
  answer?: string;
  solution?: string | null;
  status?: Question["status"];
  reviewNote?: string | null;
  source?: string | null;
}

export interface PaperManageDetail {
  id: string;
  title: string;
  subject: string;
  mode: string;
  durationMin: number | null;
  source?: string | null;
  origin?: "MANUAL" | "AUTO_SET";
  status: "DRAFT" | "READY" | "ARCHIVED";
  createdAt: string;
  stats: PaperStats;
  questions: PaperManageQuestion[];
}

// ---- 退回题目一键自动修正 ----

export interface AutoFixDiff {
  code: string;
  label: string;
  field: string;
  before: string;
  after: string;
  why?: string;
  /** 是否由退回意见中的关键词定向命中 */
  targeted?: boolean;
}

export interface AutoFixManual {
  code: string;
  label: string;
  detail?: string;
  targeted?: boolean;
}

export interface AutoFixPlan {
  id: string;
  applied: boolean;
  status?: Question["status"];
  reviewNote?: string | null;
  fixes: AutoFixDiff[];
  manual: AutoFixManual[];
  patch: Record<string, unknown>;
  /** 修正后仍存在的问题;为空表示体检通过 */
  remaining: string[];
  clean: boolean;
  targetedCodes: string[];
  noteMatched: boolean;
  preview: {
    stem: string;
    options: string[];
    answer: string;
    solution: string;
    difficulty: number;
  };
}

export interface AutoFixBatchItem {
  id: string;
  stem: string;
  reviewNote: string | null;
  fixCount: number;
  fixes: { code: string; label: string; field: string; targeted?: boolean }[];
  manual: AutoFixManual[];
  remaining: string[];
  clean: boolean;
  willResubmit: boolean;
}
