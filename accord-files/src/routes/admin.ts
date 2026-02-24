import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth.js";
import { adminMiddleware } from "../middleware/admin.js";
import type { AppEnv } from "../types.js";
import { ergoPost } from "../ergoClient.js";
import { securityLog, clientIp, getSecurityLogs } from "../securityLog.js";
import { getAllProfiles } from "../profileStore.js";

const admin = new Hono<AppEnv>();

/** Server start time for uptime calculation. */
const serverStartTime = Date.now();

// All admin routes require auth + admin check
admin.use("/api/admin/*", authMiddleware, adminMiddleware);

// --- GET /api/admin/check ---
// Simple endpoint that returns 200 if the user is admin (auth + admin middleware already applied).

admin.get("/api/admin/check", (c) => {
  return c.json({ admin: true });
});

// --- GET /api/admin/stats ---

admin.get("/api/admin/stats", async (c) => {
  const profiles = getAllProfiles();
  const profileCount = Object.keys(profiles).length;

  // Try to get richer stats from Ergo, fall back to profile-based counts
  let channels: number | null = null;
  let registeredAccounts: number | null = null;

  try {
    const res = await ergoPost("/v1/status", {});
    if (res.ok) {
      const body = (await res.json()) as {
        success?: boolean;
        channels?: number;
        clients?: number;
        registered_accounts?: number;
      };
      if (body.success) {
        channels = body.channels ?? null;
        registeredAccounts = body.registered_accounts ?? null;
      }
    }
  } catch {
    // Ergo unavailable — use fallback data
  }

  return c.json({
    registeredAccounts: registeredAccounts ?? profileCount,
    profileCount,
    channels: channels ?? 0,
    uptimeMs: Date.now() - serverStartTime,
    uptimeSeconds: Math.floor((Date.now() - serverStartTime) / 1000),
  });
});

// --- GET /api/admin/users ---

admin.get("/api/admin/users", (c) => {
  const profiles = getAllProfiles();

  const users = Object.entries(profiles).map(([account, profile]) => ({
    account,
    displayName: profile.displayName ?? null,
    status: profile.status ?? null,
    updatedAt: profile.updatedAt,
  }));

  return c.json({ users, total: users.length });
});

// --- POST /api/admin/kick ---

admin.post("/api/admin/kick", async (c) => {
  let body: { channel?: string; nick?: string; reason?: string };
  try {
    body = await c.req.json<typeof body>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const { channel, nick, reason } = body;

  if (!channel || typeof channel !== "string") {
    return c.json({ error: "Missing or invalid channel" }, 400);
  }
  if (!nick || typeof nick !== "string") {
    return c.json({ error: "Missing or invalid nick" }, 400);
  }
  if (channel.length > 200 || nick.length > 200) {
    return c.json({ error: "Parameter too long" }, 400);
  }
  if (reason !== undefined && (typeof reason !== "string" || reason.length > 500)) {
    return c.json({ error: "Invalid reason" }, 400);
  }

  // Proxy kick via Ergo HTTP API
  try {
    const res = await ergoPost("/v1/cs/kick", {
      channel,
      nick,
      reason: reason ?? "Kicked by admin",
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "unknown error");
      return c.json({ error: "Kick failed", detail: errBody }, 502);
    }
  } catch {
    return c.json({ error: "IRC service unavailable" }, 502);
  }

  const user = c.get("user");
  securityLog("admin.kick", {
    account: user.sub,
    ip: clientIp(c),
    detail: `kicked ${nick} from ${channel}${reason ? `: ${reason}` : ""}`,
  });

  return c.json({ success: true, channel, nick });
});

// --- POST /api/admin/ban ---

admin.post("/api/admin/ban", async (c) => {
  let body: { channel?: string; nick?: string; reason?: string; duration?: string };
  try {
    body = await c.req.json<typeof body>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const { channel, nick, reason, duration } = body;

  if (!channel || typeof channel !== "string") {
    return c.json({ error: "Missing or invalid channel" }, 400);
  }
  if (!nick || typeof nick !== "string") {
    return c.json({ error: "Missing or invalid nick" }, 400);
  }
  if (channel.length > 200 || nick.length > 200) {
    return c.json({ error: "Parameter too long" }, 400);
  }
  if (reason !== undefined && (typeof reason !== "string" || reason.length > 500)) {
    return c.json({ error: "Invalid reason" }, 400);
  }
  if (duration !== undefined && (typeof duration !== "string" || duration.length > 50)) {
    return c.json({ error: "Invalid duration" }, 400);
  }

  // Proxy ban via Ergo HTTP API
  try {
    const res = await ergoPost("/v1/cs/ban", {
      channel,
      nick,
      reason: reason ?? "Banned by admin",
      duration: duration ?? "0", // 0 = permanent
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "unknown error");
      return c.json({ error: "Ban failed", detail: errBody }, 502);
    }
  } catch {
    return c.json({ error: "IRC service unavailable" }, 502);
  }

  const user = c.get("user");
  securityLog("admin.ban", {
    account: user.sub,
    ip: clientIp(c),
    detail: `banned ${nick} from ${channel}${duration ? ` for ${duration}` : " permanently"}${reason ? `: ${reason}` : ""}`,
  });

  return c.json({ success: true, channel, nick, duration: duration ?? "permanent" });
});

// --- GET /api/admin/audit ---

admin.get("/api/admin/audit", (c) => {
  const offsetParam = c.req.query("offset");
  const limitParam = c.req.query("limit");

  const offset = offsetParam ? parseInt(offsetParam, 10) : 0;
  const limit = limitParam ? parseInt(limitParam, 10) : 50;

  if (Number.isNaN(offset) || offset < 0) {
    return c.json({ error: "Invalid offset" }, 400);
  }
  if (Number.isNaN(limit) || limit < 1 || limit > 200) {
    return c.json({ error: "Invalid limit (1-200)" }, 400);
  }

  const user = c.get("user");
  securityLog("admin.audit_view", {
    account: user.sub,
    ip: clientIp(c),
    detail: `offset=${offset} limit=${limit}`,
  });

  const { entries, total } = getSecurityLogs(offset, limit);

  return c.json({ entries, total, offset, limit });
});

// --- POST /api/admin/announce ---

admin.post("/api/admin/announce", async (c) => {
  let body: { channel?: string; message?: string };
  try {
    body = await c.req.json<typeof body>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const { channel, message } = body;

  if (!channel || typeof channel !== "string") {
    return c.json({ error: "Missing or invalid channel" }, 400);
  }
  if (!message || typeof message !== "string") {
    return c.json({ error: "Missing or invalid message" }, 400);
  }
  if (channel.length > 200) {
    return c.json({ error: "Channel name too long" }, 400);
  }
  if (message.length > 2000) {
    return c.json({ error: "Message too long (max 2000 chars)" }, 400);
  }

  // Send announcement via Ergo HTTP API
  try {
    const res = await ergoPost("/v1/cs/privmsg", {
      channel,
      message,
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "unknown error");
      return c.json({ error: "Announce failed", detail: errBody }, 502);
    }
  } catch {
    return c.json({ error: "IRC service unavailable" }, 502);
  }

  const user = c.get("user");
  securityLog("admin.announce", {
    account: user.sub,
    ip: clientIp(c),
    detail: `announced to ${channel}: ${message.slice(0, 100)}`,
  });

  return c.json({ success: true, channel });
});

export { admin };
