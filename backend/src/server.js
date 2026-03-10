import express from "express";
import dotenv from "dotenv";

import healthRoutes from "./routes/healthRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import usersRoutes from "./routes/usersRoutes.js";
import dataRoutes from "./routes/dataRoutes.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json()); // Parse incoming JSON bodies

app.use("/health", healthRoutes);       // GET  /health
app.use("/auth", authRoutes);           // POST /auth/login, /auth/register, /auth/logout
app.use("/users", usersRoutes);         // GET  /users, /users/:id  |  PATCH /users/:id
app.use("/api/data", dataRoutes);       // GET/POST /api/data  |  GET/DELETE /api/data/:id

app.get("/", (req, res) => {
  res.status(200).json({
    message: "Backend service is running",
    service: "rate-limited-api-backend",
    port: PORT,
    routes: [
      "GET  /health",
      "POST /auth/login",
      "POST /auth/register",
      "POST /auth/logout",
      "GET  /users",
      "GET  /users/:id",
      "PATCH /users/:id",
      "GET  /api/data",
      "GET  /api/data/:id",
      "POST /api/data",
      "DELETE /api/data/:id",
    ],
  });
});

app.use((req, res) => {
  res.status(404).json({ error: `Route '${req.method} ${req.path}' not found.` });
});

app.listen(PORT, () => {
  console.log(`Backend service running on http://localhost:${PORT}`);
});
