import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { auth } from "./routes/auth.js";
import { livekit } from "./routes/livekit.js";
import { config } from "./routes/config.js";
import { files } from "./routes/files.js";
import { preview } from "./routes/preview.js";
import { createInviteRouter } from "./routes/invite.js";
import { env } from "./env.js";

const app = new Hono();
const { router: invite } = createInviteRouter();

app.use("*", logger());

// CORS middleware — restrict to configured origin
if (env.ALLOWED_ORIGIN) {
  app.use("*", cors({ origin: env.ALLOWED_ORIGIN }));
}

// Global error handler — prevents stack trace leaks to clients (CR-027)
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Internal server error" }, 500);
});

// Mount routes
app.route("/", auth);
app.route("/", livekit);
app.route("/", config);
app.route("/", files);
app.route("/", preview);
app.route("/", invite);

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

const port = env.PORT;
console.log(`virc-files listening on :${port}`);

export default {
  port,
  fetch: app.fetch,
};
