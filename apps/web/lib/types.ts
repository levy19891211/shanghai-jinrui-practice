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
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
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
  questions: QuizQuestion[];
}

export interface GradeResult {
  score: number;
  total: number;
  correctCount: number;
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
  wrongCount: number;
  mastered: boolean;
}

export interface StatsData {
  byTopic: { topic: string; attempts: number; correctRate: number }[];
  totalAnswered: number;
}
