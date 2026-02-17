import type { Context, Next } from "hono";
import { jwtVerify } from "jose";
import { env } from "../env.js";
import { JWT_ISSUER, JWT_AUDIENCE } from "../constants.js";

/** Cached JWT secret encoding — avoids re-encoding on every request. */
let _jwtSecretKey: Uint8Array | null = null;
export function getJwtSecretKey(): Uint8Array {
  if (!_jwtSecretKey) {
    _jwtSecretKey = new TextEncoder().encode(env.JWT_SECRET);
  }
  return _jwtSecretKey;
}

export interface JwtPayload {
  sub: string;
  iss: string;
  aud?: string | string[];
  iat: number;
  exp: number;
  srv: string;
}

export async function authMiddleware(c: Context, next: Next) {
  const header = c.req.header("Authorization");
  if (!header?.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }

  const token = header.slice(7);

  try {
    const { payload } = await jwtVerify(token, getJwtSecretKey(), {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      algorithms: ["HS256"],
    });

    // Validate required claims — jose checks signature/expiry but not shape
    if (typeof payload.sub !== "string" || !payload.sub) {
      return c.json({ error: "Invalid token: missing subject" }, 401);
    }
    if (typeof payload.srv !== "string" || !payload.srv) {
      return c.json({ error: "Invalid token: missing server" }, 401);
    }

    if (payload.srv !== env.SERVER_ID) {
      return c.json({ error: "Invalid token: wrong server" }, 401);
    }

    c.set("user", payload as unknown as JwtPayload);
    await next();
  } catch {
    return c.json({ error: "Invalid or expired token" }, 401);
  }
}
