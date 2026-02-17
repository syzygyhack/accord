import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { rateLimit } from "./middleware/rateLimit.js";
import { auth } from "./routes/auth.js";
import { livekit } from "./routes/livekit.js";
import { config } from "./routes/config.js";
import { files } from "./routes/files.js";
import { preview } from "./routes/preview.js";
import { createInviteRouter } from "./routes/invite.js";
import { accountInfo } from "./routes/accountInfo.js";
import { account } from "./routes/account.js";
import { env } from "./env.js";

const app = new Hono();
const { router: invite } = createInviteRouter();

app.use("*", logger());

// CORS middleware — always applied. When ALLOWED_ORIGIN is set, only that
// origin is permitted. When unset, all cross-origin requests are rejected
// (no Access-Control-Allow-Origin header is sent).
const allowedOrigins = env.ALLOWED_ORIGINS;
app.use("*", cors({
  origin: allowedOrigins.length > 0
    ? (origin) => (allowedOrigins.includes(origin) ? origin : "")
    : () => "",  // empty string = browser rejects cross-origin response
}));

// Rate limiting on sensitive endpoints (configurable via env)
app.use("/api/auth", rateLimit({ max: env.RATE_LIMIT_AUTH_MAX, windowMs: env.RATE_LIMIT_AUTH_WINDOW }));
app.use("/api/preview", rateLimit({ max: env.RATE_LIMIT_PREVIEW_MAX, windowMs: env.RATE_LIMIT_WINDOW }));
app.use("/api/upload", rateLimit({ max: env.RATE_LIMIT_UPLOAD_MAX, windowMs: env.RATE_LIMIT_WINDOW }));
app.use("/api/invite", rateLimit({ max: env.RATE_LIMIT_INVITE_MAX, windowMs: env.RATE_LIMIT_WINDOW }));
app.use("/api/account-info", rateLimit({ max: env.RATE_LIMIT_PREVIEW_MAX, windowMs: env.RATE_LIMIT_WINDOW }));
app.use("/api/account/*", rateLimit({ max: env.RATE_LIMIT_AUTH_MAX, windowMs: env.RATE_LIMIT_AUTH_WINDOW }));
app.use("/api/livekit/*", rateLimit({ max: 20, windowMs: env.RATE_LIMIT_WINDOW }));
// File downloads: generous limit to allow page loads with many embeds
app.use("/api/files/*", rateLimit({ max: 100, windowMs: env.RATE_LIMIT_WINDOW }));

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
app.route("/", accountInfo);
app.route("/", account);

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

const port = env.PORT;
console.log(`accord-files listening on :${port}`);

export default {
  port,
  fetch: app.fetch,
};
