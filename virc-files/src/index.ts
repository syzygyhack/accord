import { Hono } from "hono";
import { logger } from "hono/logger";
import { auth } from "./routes/auth.js";
import { livekit } from "./routes/livekit.js";
import { config } from "./routes/config.js";
import { env } from "./env.js";

const app = new Hono();

app.use("*", logger());

// Mount routes
app.route("/", auth);
app.route("/", livekit);
app.route("/", config);

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

const port = env.PORT;
console.log(`virc-files listening on :${port}`);

export default {
  port,
  fetch: app.fetch,
};
