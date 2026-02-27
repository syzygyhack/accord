import { Hono } from "hono";
import { SignJWT } from "jose";
import { env } from "../env.js";
import { JWT_ISSUER, JWT_AUDIENCE } from "../constants.js";
import { ergoPost } from "../ergoClient.js";
import { getJwtSecretKey } from "../middleware/auth.js";
import { securityLog, clientIp } from "../securityLog.js";

const auth = new Hono();

auth.post("/api/auth", async (c) => {
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
  let ergoRes: Response;
  try {
    ergoRes = await ergoPost("/v1/check_auth", {
      accountName: account,
      passphrase: password,
    });
  } catch {
    return c.json({ error: "Auth service unavailable" }, 503);
  }

  if (!ergoRes.ok) {
    // 4xx = Ergo rejected the request (bad credentials or access denied)
    // 5xx = upstream failure
    if (ergoRes.status >= 400 && ergoRes.status < 500) {
      securityLog("auth.failure", { account, ip: clientIp(c), detail: "ergo_rejected" });
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
    securityLog("auth.failure", { account, ip: clientIp(c), detail: "invalid_credentials" });
    return c.json({ error: "Invalid credentials" }, 401);
  }

  // Mint JWT
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
    .sign(getJwtSecretKey());

  securityLog("auth.success", { account, ip: clientIp(c) });
  c.header("Cache-Control", "no-store");
  return c.json({ token });
});

export { auth };
