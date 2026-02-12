import type { Context, Next } from "hono";
import { jwtVerify } from "jose";
import { env } from "../env.js";

export interface JwtPayload {
  sub: string;
  iss: string;
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
    const secret = new TextEncoder().encode(env.JWT_SECRET);
    const { payload } = await jwtVerify(token, secret, {
      issuer: "virc-files",
    });

    c.set("user", payload as unknown as JwtPayload);
    await next();
  } catch {
    return c.json({ error: "Invalid or expired token" }, 401);
  }
}
