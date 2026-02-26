import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth.js";
import type { AppEnv } from "../types.js";
import { ergoPost } from "../ergoClient.js";
import { securityLog, clientIp } from "../securityLog.js";

const account = new Hono<AppEnv>();

/**
 * GET /api/account/email — Fetch the authenticated user's email.
 *
 * Proxies to Ergo's /v1/account_details (legacy name for /v1/ns/info)
 * to get the current email. Only returns the email for the requesting user.
 */
account.get("/api/account/email", authMiddleware, async (c) => {
  const user = c.get("user");

  let ergoRes: Response;
  try {
    ergoRes = await ergoPost("/v1/account_details", { accountName: user.sub });
  } catch {
    return c.json({ error: "Account service unavailable" }, 502);
  }

  if (!ergoRes.ok) {
    return c.json({ error: "Could not fetch account info" }, 502);
  }

  let ergoBody: { success?: boolean; email?: string };
  try {
    ergoBody = (await ergoRes.json()) as typeof ergoBody;
  } catch {
    return c.json({ error: "Account service returned invalid response" }, 502);
  }

  if (!ergoBody.success) {
    return c.json({ error: "Account not found" }, 404);
  }

  return c.json({ email: ergoBody.email ?? "" });
});

/**
 * POST /api/account/password — Change the authenticated user's password.
 *
 * Verifies the current password via Ergo check_auth, then sets the new
 * password via /v1/ns/passwd (requires Ergo with this endpoint enabled).
 *
 * Body: { currentPassword: string, newPassword: string }
 */
account.post("/api/account/password", authMiddleware, async (c) => {
  const user = c.get("user");

  let body: { currentPassword?: string; newPassword?: string };
  try {
    body = await c.req.json<typeof body>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const { currentPassword, newPassword } = body;

  if (!currentPassword || !newPassword) {
    return c.json({ error: "Missing currentPassword or newPassword" }, 400);
  }

  if (typeof currentPassword !== "string" || typeof newPassword !== "string" ||
      currentPassword.length > 1000 || newPassword.length > 1000) {
    return c.json({ error: "Invalid input format" }, 400);
  }

  if (newPassword.length < 8) {
    return c.json({ error: "New password must be at least 8 characters" }, 400);
  }

  // Verify current password via Ergo check_auth
  let verifyRes: Response;
  try {
    verifyRes = await ergoPost("/v1/check_auth", {
      accountName: user.sub,
      passphrase: currentPassword,
    });
  } catch {
    return c.json({ error: "Account service unavailable" }, 502);
  }

  if (verifyRes.status >= 500) {
    return c.json({ error: "Account service error" }, 502);
  }

  if (!verifyRes.ok) {
    return c.json({ error: "Current password is incorrect" }, 403);
  }

  let verifyBody: { success?: boolean };
  try {
    verifyBody = (await verifyRes.json()) as { success?: boolean };
  } catch {
    return c.json({ error: "Account service returned invalid response" }, 502);
  }

  if (!verifyBody.success) {
    return c.json({ error: "Current password is incorrect" }, 403);
  }

  // Set new password via Ergo /v1/ns/passwd
  let setRes: Response;
  try {
    setRes = await ergoPost("/v1/ns/passwd", {
      accountName: user.sub,
      passphrase: newPassword,
    });
  } catch {
    return c.json({ error: "Account service unavailable" }, 502);
  }

  if (!setRes.ok) {
    return c.json({ error: "Failed to update password" }, 502);
  }

  securityLog("account.password_change", { account: user.sub, ip: clientIp(c) });
  return c.json({ success: true });
});

export { account };
