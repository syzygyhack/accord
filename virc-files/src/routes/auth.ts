import { Hono } from "hono";
import { SignJWT } from "jose";
import { env } from "../env.js";

const auth = new Hono();

auth.post("/api/auth", async (c) => {
  // Origin check: reject cross-origin POSTs when ALLOWED_ORIGIN is configured
  const allowed = env.ALLOWED_ORIGIN;
  if (allowed) {
    const origin = c.req.header("Origin") ?? "";
    if (origin && origin !== allowed) {
      return c.json({ error: "Origin not allowed" }, 403);
    }
  }

  const body = await c.req.json<{ account?: string; password?: string }>();
  const { account, password } = body;

  if (!account || !password) {
    return c.json({ error: "Missing account or password" }, 400);
  }

  // Validate credentials against Ergo HTTP API
  const ergoUrl = `${env.ERGO_API}/v1/check_auth`;
  let ergoRes: Response;
  try {
    ergoRes = await fetch(ergoUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountName: account,
        passphrase: password,
      }),
    });
  } catch {
    return c.json({ error: "Auth service unavailable" }, 503);
  }

  if (!ergoRes.ok) {
    return c.json({ error: "Invalid credentials" }, 401);
  }

  const ergoBody = (await ergoRes.json()) as { success?: boolean };
  if (!ergoBody.success) {
    return c.json({ error: "Invalid credentials" }, 401);
  }

  // Mint JWT
  const secret = new TextEncoder().encode(env.JWT_SECRET);
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({
    sub: account,
    iss: "virc-files",
    iat: now,
    exp: now + 3600, // 1 hour
    srv: "virc.local",
  })
    .setProtectedHeader({ alg: "HS256" })
    .sign(secret);

  return c.json({ token });
});

export { auth };
