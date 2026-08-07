import express from "express";
import cors from "cors";
import { ok, fail } from "./lib/res.js";
import { llmConfigured } from "./lib/llm.js";
import authRouter from "./routes/auth.js";
import questionsRouter from "./routes/questions.js";
import sessionsRouter from "./routes/sessions.js";
import meRouter from "./routes/me.js";
import teacherRouter from "./routes/teacher.js";
import papersRouter from "./routes/papers.js";
import interviewRouter from "./routes/interview.js";

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/api/health", (req, res) => {
    ok(res, { status: "ok", time: new Date().toISOString(), llmConfigured: llmConfigured() });
  });

  app.use("/api/auth", authRouter);
  app.use("/api/questions", questionsRouter);
  app.use("/api/sessions", sessionsRouter);
  app.use("/api/me", meRouter);
  app.use("/api/teacher", teacherRouter);
  app.use("/api/papers", papersRouter);
  app.use("/api/interview", interviewRouter);

  // 404 兜底
  app.use((req, res) => fail(res, 404, "not found"));

  // 统一错误处理
  app.use((err, req, res, next) => {
    console.error("[error]", err);
    fail(res, 500, "服务器内部错误");
  });

  return app;
}
