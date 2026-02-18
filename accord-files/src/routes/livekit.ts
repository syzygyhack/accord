import { Hono } from "hono";
import { AccessToken } from "livekit-server-sdk";
import { authMiddleware } from "../middleware/auth.js";
import type { AppEnv } from "../types.js";
import { env } from "../env.js";

const livekit = new Hono<AppEnv>();

livekit.post("/api/livekit/token", authMiddleware, async (c) => {
  const user = c.get("user");

  let body: { channel?: string; room?: string };
  try {
    body = await c.req.json<{ channel?: string; room?: string }>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  // Accept "channel" (client sends this) or "room" for backwards compat
  const room = body.channel ?? body.room;

  if (!room || typeof room !== "string") {
    return c.json({ error: "Missing channel" }, 400);
  }

  // Validate room name: channels start with #, DM rooms start with dm:
  // Reasonable length, no control chars
  const validRoom = (room.startsWith("#") || room.startsWith("dm:")) &&
    room.length > 1 && room.length <= 200 && !/[\x00-\x1f]/.test(room);
  if (!validRoom) {
    return c.json({ error: "Invalid room name" }, 400);
  }

  // SECURITY: Channel membership is NOT verified here because Ergo's HTTP API
  // does not expose a channel membership query endpoint (as of v2.14).
  //
  // Risk: An authenticated user can obtain a voice token for any channel room
  // name, even if they haven't JOINed the IRC channel. Mitigations:
  //   1. Voice rooms are isolated from IRC — no chat messages are bridged
  //   2. Rate limiting (20 req/min) prevents room exhaustion attacks
  //   3. LiveKit rooms have max_participants=50 and empty_timeout=300s
  //   4. The user must still have valid JWT auth (account on this server)
  //
  // TODO: If Ergo adds a /v1/channel_members or similar endpoint, add a
  // membership check here before issuing the token.

  // For DM rooms (format: "dm:account1:account2"), verify the requesting user
  // is one of the two participants to prevent eavesdropping.
  if (room.startsWith("dm:")) {
    const parts = room.split(":");
    if (parts.length !== 3) {
      return c.json({ error: "Invalid DM room format" }, 400);
    }
    const [, account1, account2] = parts;
    const userAccount = user.sub.toLowerCase();
    if (account1.toLowerCase() !== userAccount && account2.toLowerCase() !== userAccount) {
      return c.json({ error: "Not a participant in this DM" }, 403);
    }
  }

  const at = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
    identity: user.sub,
    ttl: 28800, // 8 hours — LiveKit disconnects on expiry; client handles via RoomEvent.Disconnected
  });

  at.addGrant({
    roomJoin: true,
    room,
    canPublish: true,
    canSubscribe: true,
  });

  const token = await at.toJwt();
  return c.json({ token, url: env.LIVEKIT_CLIENT_URL });
});

export { livekit };
