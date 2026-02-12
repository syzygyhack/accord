import { Hono } from "hono";
import { AccessToken } from "livekit-server-sdk";
import { authMiddleware } from "../middleware/auth.js";
import type { AppEnv } from "../types.js";
import { env } from "../env.js";

const livekit = new Hono<AppEnv>();

livekit.post("/api/livekit/token", authMiddleware, async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ room?: string }>();
  const { room } = body;

  if (!room) {
    return c.json({ error: "Missing room" }, 400);
  }

  const at = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
    identity: user.sub,
    ttl: 3600, // 1 hour
  });

  at.addGrant({
    roomJoin: true,
    room,
    canPublish: true,
    canSubscribe: true,
  });

  const token = await at.toJwt();
  return c.json({ token });
});

export { livekit };
