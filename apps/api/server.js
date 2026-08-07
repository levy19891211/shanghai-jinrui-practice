import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

// 统一响应结构:{ code, message, data }
const ok = (res, data) => res.json({ code: 0, message: "ok", data });
const fail = (res, code, message) => res.status(code >= 500 ? 500 : 400).json({ code, message, data: null });

// 健康检查(GET /api/health)
app.get("/api/health", (req, res) => {
  ok(res, { status: "ok", time: new Date().toISOString() });
});

// 404 兜底
app.use((req, res) => fail(res, 404, "not found"));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`API server running at http://localhost:${PORT}`);
});
