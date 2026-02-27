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
import { profile } from "./routes/profile.js";
import { admin } from "./routes/admin.js";
import { env } from "./env.js";

const app = new Hono();
const { router: invite } = createInviteRouter();

app.use("*", logger());

// CORS middleware — reflect the request Origin back. Auth is credential-based
// (JWT), not cookie-based, so Origin restrictions don't add CSRF protection.
// Desktop clients (Tauri) send their own origin and must not be blocked.
app.use("*", cors({
  origin: (origin) => origin || "*",
}));

// Rate limiting on sensitive endpoints (configurable via env)
app.use("/api/auth", rateLimit({ max: env.RATE_LIMIT_AUTH_MAX, windowMs: env.RATE_LIMIT_AUTH_WINDOW }));
app.use("/api/preview", rateLimit({ max: env.RATE_LIMIT_PREVIEW_MAX, windowMs: env.RATE_LIMIT_WINDOW }));
app.use("/api/upload", rateLimit({ max: env.RATE_LIMIT_UPLOAD_MAX, windowMs: env.RATE_LIMIT_WINDOW }));
app.use("/api/invite", rateLimit({ max: env.RATE_LIMIT_INVITE_MAX, windowMs: env.RATE_LIMIT_WINDOW }));
app.use("/api/account-info", rateLimit({ max: env.RATE_LIMIT_PREVIEW_MAX, windowMs: env.RATE_LIMIT_WINDOW }));
app.use("/api/account/*", rateLimit({ max: env.RATE_LIMIT_AUTH_MAX, windowMs: env.RATE_LIMIT_AUTH_WINDOW }));
app.use("/api/livekit/*", rateLimit({ max: 20, windowMs: env.RATE_LIMIT_WINDOW }));
// Profile endpoints
app.use("/api/profile/*", rateLimit({ max: env.RATE_LIMIT_PREVIEW_MAX, windowMs: env.RATE_LIMIT_WINDOW }));
app.use("/api/profiles", rateLimit({ max: env.RATE_LIMIT_PREVIEW_MAX, windowMs: env.RATE_LIMIT_WINDOW }));
// File downloads: generous limit to allow page loads with many embeds
app.use("/api/files/*", rateLimit({ max: 100, windowMs: env.RATE_LIMIT_WINDOW }));
// Admin endpoints
app.use("/api/admin/*", rateLimit({ max: env.RATE_LIMIT_AUTH_MAX, windowMs: env.RATE_LIMIT_AUTH_WINDOW }));

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
app.route("/", profile);
app.route("/", admin);

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

const port = env.PORT;
console.log(`accord-files listening on :${port}`);

export default {
  port,
  fetch: app.fetch,
};
