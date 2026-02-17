import { describe, test, expect } from "bun:test";
import { Hono } from "hono";
import { setupEnv, createTestJwt, req } from "./helpers.js";

// Set env before any source imports
setupEnv();

import { authMiddleware, type JwtPayload } from "../src/middleware/auth.js";

// Create a minimal Hono app with the auth middleware to test it in isolation.
function createTestApp() {
  const app = new Hono<{ Variables: { user: JwtPayload } }>();

  app.use("/protected/*", authMiddleware);
  app.get("/protected/resource", (c) => {
    const user = c.get("user");
    return c.json({ sub: user.sub, iss: user.iss, srv: user.srv });
  });

  return app;
}

describe("authMiddleware", () => {
  test("rejects request without Authorization header", async () => {
    const app = createTestApp();
    const res = await app.fetch(req("/protected/resource"));
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("Authorization");
  });

  test("rejects request with non-Bearer Authorization", async () => {
    const app = createTestApp();
    const res = await app.fetch(req("/protected/resource", {
      headers: { Authorization: "Basic dXNlcjpwYXNz" },
    }));
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("Authorization");
  });

  test("rejects request with malformed JWT", async () => {
    const app = createTestApp();
    const res = await app.fetch(req("/protected/resource", {
      headers: { Authorization: "Bearer not.a.jwt" },
    }));
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("Invalid or expired");
  });

  test("rejects expired tokens", async () => {
    const app = createTestApp();
    const expired = await createTestJwt("alice", { expired: true });
    const res = await app.fetch(req("/protected/resource", {
      headers: { Authorization: `Bearer ${expired}` },
    }));
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("Invalid or expired");
  });

  test("accepts valid token and sets user context", async () => {
    const app = createTestApp();
    const token = await createTestJwt("alice");
    const res = await app.fetch(req("/protected/resource", {
      headers: { Authorization: `Bearer ${token}` },
    }));
    expect(res.status).toBe(200);
    const body = await res.json() as { sub: string; iss: string; srv: string };
    expect(body.sub).toBe("alice");
    expect(body.iss).toBe("accord-files");
    expect(body.srv).toBe("accord.local");
  });

  test("rejects token issued for a different server", async () => {
    const app = createTestApp();
    const token = await createTestJwt("alice", { srv: "other.example.com" });
    const res = await app.fetch(req("/protected/resource", {
      headers: { Authorization: `Bearer ${token}` },
    }));
    expect(res.status).toBe(401);
  });

  test("sets correct user sub from token", async () => {
    const app = createTestApp();
    const token = await createTestJwt("bob");
    const res = await app.fetch(req("/protected/resource", {
      headers: { Authorization: `Bearer ${token}` },
    }));
    expect(res.status).toBe(200);
    const body = await res.json() as { sub: string };
    expect(body.sub).toBe("bob");
  });
});
