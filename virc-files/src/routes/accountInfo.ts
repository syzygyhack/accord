import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth.js";
import { env } from "../env.js";

const ERGO_TIMEOUT_MS = 10_000;

const accountInfo = new Hono();

accountInfo.get("/api/account-info", authMiddleware, async (c) => {
  const account = c.req.query("account");

  if (!account) {
    return c.json({ error: "Missing required account parameter" }, 400);
  }

  // Proxy to Ergo /v1/ns/info
  const ergoUrl = `${env.ERGO_API}/v1/ns/info`;
  let ergoRes: Response;
  try {
    ergoRes = await fetch(ergoUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${env.ERGO_API_TOKEN}`,
      },
      signal: AbortSignal.timeout(ERGO_TIMEOUT_MS),
      body: JSON.stringify({ accountName: account }),
    });
  } catch {
    return c.json({ error: "Account info service unavailable" }, 502);
  }

  if (!ergoRes.ok) {
    if (ergoRes.status === 404 || ergoRes.status === 400) {
      return c.json({ error: "Account not found" }, 404);
    }
    return c.json({ error: "Account info service unavailable" }, 502);
  }

  let ergoBody: {
    success?: boolean;
    accountName?: string;
    registeredAt?: string;
    email?: string;
    channels?: string[];
  };
  try {
    ergoBody = (await ergoRes.json()) as typeof ergoBody;
  } catch {
    return c.json({ error: "Account info service returned invalid response" }, 502);
  }

  if (!ergoBody.success) {
    return c.json({ error: "Account not found" }, 404);
  }

  // Return only non-sensitive fields (no email)
  return c.json({
    accountName: ergoBody.accountName,
    registeredAt: ergoBody.registeredAt,
  });
});

export { accountInfo };
