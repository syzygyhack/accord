import { Hono } from "hono";
import { SignJWT } from "jose";
import { env } from "../env.js";

const ERGO_TIMEOUT_MS = 10_000;
const JWT_ISSUER = "accord-files";
const JWT_AUDIENCE = "accord-files";

const auth = new Hono();

auth.post("/api/auth", async (c) => {
  // Origin check: reject cross-origin POSTs when ALLOWED_ORIGIN is configured
  const allowedOrigins = env.ALLOWED_ORIGINS;
  if (allowedOrigins.length > 0) {
    const origin = c.req.header("Origin");
    if (!origin || !allowedOrigins.includes(origin)) {
      return c.json({ error: "Origin not allowed" }, 403);
    }
  }

  let body: { account?: string; password?: string };
  try {
    body = await c.req.json<{ account?: string; password?: string }>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const { account, password } = body;

  if (!account || !password) {
    return c.json({ error: "Missing account or password" }, 400);
  }

  // Reject oversized input to prevent DoS via large strings
  if (typeof account !== "string" || typeof password !== "string" ||
      account.length > 200 || password.length > 1000) {
    return c.json({ error: "Invalid credentials format" }, 400);
  }

  // Validate credentials against Ergo HTTP API
  const ergoUrl = `${env.ERGO_API}/v1/check_auth`;
  let ergoRes: Response;
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${env.ERGO_API_TOKEN}`,
    };
    ergoRes = await fetch(ergoUrl, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(ERGO_TIMEOUT_MS),
      body: JSON.stringify({
        accountName: account,
        passphrase: password,
      }),
    });
  } catch {
    return c.json({ error: "Auth service unavailable" }, 503);
  }

  if (!ergoRes.ok) {
    // 4xx = Ergo rejected the request (bad credentials or access denied)
    // 5xx = upstream failure
    if (ergoRes.status >= 400 && ergoRes.status < 500) {
      return c.json({ error: "Invalid credentials" }, 401);
    }
    console.warn(`Ergo auth check failed: ${ergoRes.status}`);
    return c.json({ error: "Auth service unavailable" }, 503);
  }

  let ergoBody: { success?: boolean };
  try {
    ergoBody = (await ergoRes.json()) as { success?: boolean };
  } catch {
    return c.json({ error: "Auth service returned invalid response" }, 503);
  }

  if (!ergoBody.success) {
    return c.json({ error: "Invalid credentials" }, 401);
  }

  // Mint JWT
  const secret = new TextEncoder().encode(env.JWT_SECRET);
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({
    srv: env.SERVER_ID,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(JWT_ISSUER)
    .setSubject(account)
    .setIssuedAt(now)
    .setExpirationTime(now + env.JWT_EXPIRY)
    .setAudience(JWT_AUDIENCE)
    .sign(secret);

  c.header("Cache-Control", "no-store");
  return c.json({ token });
});

export { auth };
