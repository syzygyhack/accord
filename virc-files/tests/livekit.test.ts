import { describe, test, expect } from "bun:test";
import { setupEnv, createTestJwt, req } from "./helpers.js";

// Set env before any source imports
setupEnv();

import { livekit } from "../src/routes/livekit.js";

describe("POST /api/livekit/token", () => {
  test("returns 401 without Authorization header", async () => {
    const res = await livekit.fetch(req("/api/livekit/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room: "#general" }),
    }));
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("Authorization");
  });

  test("returns 401 with invalid JWT", async () => {
    const res = await livekit.fetch(req("/api/livekit/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer invalid.token.here",
      },
      body: JSON.stringify({ room: "#general" }),
    }));
    expect(res.status).toBe(401);
  });

  test("returns 400 when room is missing", async () => {
    const token = await createTestJwt("alice");
    const res = await livekit.fetch(req("/api/livekit/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({}),
    }));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("channel");
  });

  test("returns a LiveKit token and url with valid JWT and channel", async () => {
    const jwt = await createTestJwt("alice");
    const res = await livekit.fetch(req("/api/livekit/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({ channel: "#voice-lobby" }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json() as { token: string; url: string };
    expect(body.token).toBeDefined();
    expect(typeof body.token).toBe("string");
    // LiveKit tokens are JWTs — three dot-separated parts
    expect(body.token.split(".").length).toBe(3);
    // URL should be the LIVEKIT_URL from env
    expect(body.url).toBeDefined();
    expect(typeof body.url).toBe("string");
  });

  test("accepts room param for backwards compatibility", async () => {
    const jwt = await createTestJwt("alice");
    const res = await livekit.fetch(req("/api/livekit/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({ room: "#voice-lobby" }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json() as { token: string; url: string };
    expect(body.token).toBeDefined();
    expect(body.url).toBeDefined();
  });

  test("returns 401 with expired JWT", async () => {
    const expired = await createTestJwt("alice", { expired: true });
    const res = await livekit.fetch(req("/api/livekit/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${expired}`,
      },
      body: JSON.stringify({ room: "#general" }),
    }));
    expect(res.status).toBe(401);
  });
});
