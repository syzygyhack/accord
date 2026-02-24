import type { Context, Next } from "hono";
import { env } from "../env.js";

/**
 * Admin authorization middleware.
 *
 * Must be used AFTER authMiddleware (expects `user` to be set on context).
 * Checks if the authenticated user's `sub` claim is in the ADMIN_ACCOUNTS
 * environment variable (comma-separated list).
 *
 * Responds 403 if the user is not an admin.
 */
export async function adminMiddleware(c: Context, next: Next) {
  const user = c.get("user");
  if (!user?.sub) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const admins = env.ADMIN_ACCOUNTS;
  if (!admins.includes(user.sub)) {
    return c.json({ error: "Forbidden: admin access required" }, 403);
  }

  await next();
}
