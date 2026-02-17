import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth.js";
import type { AppEnv } from "../types.js";
import { env } from "../env.js";

const ERGO_TIMEOUT_MS = 10_000;

const account = new Hono<AppEnv>();

/**
 * POST /api/account/password — Change the authenticated user's password.
 *
 * Proxies to Ergo's /v1/ns/set endpoint with the new passphrase.
 * Requires the current password for verification (re-auth via Ergo check_auth).
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
    verifyRes = await fetch(`${env.ERGO_API}/v1/check_auth`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${env.ERGO_API_TOKEN}`,
      },
      signal: AbortSignal.timeout(ERGO_TIMEOUT_MS),
      body: JSON.stringify({
        accountName: user.sub,
        passphrase: currentPassword,
      }),
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

  // Set new password via Ergo /v1/ns/set
  let setRes: Response;
  try {
    setRes = await fetch(`${env.ERGO_API}/v1/ns/set`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${env.ERGO_API_TOKEN}`,
      },
      signal: AbortSignal.timeout(ERGO_TIMEOUT_MS),
      body: JSON.stringify({
        accountName: user.sub,
        passphrase: newPassword,
      }),
    });
  } catch {
    return c.json({ error: "Account service unavailable" }, 502);
  }

  if (!setRes.ok) {
    return c.json({ error: "Failed to update password" }, 502);
  }

  return c.json({ success: true });
});

/**
 * POST /api/account/email — Set or change the authenticated user's email.
 *
 * Proxies to Ergo's /v1/ns/set endpoint with the new email.
 *
 * Body: { email: string }
 */
account.post("/api/account/email", authMiddleware, async (c) => {
  const user = c.get("user");

  let body: { email?: string };
  try {
    body = await c.req.json<typeof body>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const { email } = body;

  if (!email || typeof email !== "string") {
    return c.json({ error: "Missing or invalid email" }, 400);
  }

  if (email.length > 320) {
    return c.json({ error: "Email too long" }, 400);
  }

  // Basic email format check (local@domain.tld)
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return c.json({ error: "Invalid email format" }, 400);
  }

  // Set email via Ergo /v1/ns/set
  let setRes: Response;
  try {
    setRes = await fetch(`${env.ERGO_API}/v1/ns/set`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${env.ERGO_API_TOKEN}`,
      },
      signal: AbortSignal.timeout(ERGO_TIMEOUT_MS),
      body: JSON.stringify({
        accountName: user.sub,
        email,
      }),
    });
  } catch {
    return c.json({ error: "Account service unavailable" }, 502);
  }

  if (!setRes.ok) {
    return c.json({ error: "Failed to update email" }, 502);
  }

  return c.json({ success: true });
});

export { account };
