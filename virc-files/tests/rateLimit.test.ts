import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Hono } from "hono";
import { rateLimit } from "../src/middleware/rateLimit.js";

// Rate limit tests use X-Forwarded-For for IP differentiation,
// so TRUST_PROXY must be set before the middleware is constructed.
let savedTrustProxy: string | undefined;
beforeAll(() => {
  savedTrustProxy = process.env.TRUST_PROXY;
  process.env.TRUST_PROXY = "true";
});
afterAll(() => {
  if (savedTrustProxy === undefined) {
    delete process.env.TRUST_PROXY;
  } else {
    process.env.TRUST_PROXY = savedTrustProxy;
  }
});

function buildApp(max: number, windowMs: number) {
  const app = new Hono();
  app.use("*", rateLimit({ max, windowMs }));
  app.get("/test", (c) => c.json({ ok: true }));
  return app;
}

function req(path: string, ip = "1.2.3.4"): Request {
  return new Request(`http://localhost${path}`, {
    headers: { "X-Forwarded-For": ip },
  });
}

describe("rateLimit middleware", () => {
  test("allows requests within limit", async () => {
    const app = buildApp(3, 60_000);

    for (let i = 0; i < 3; i++) {
      const res = await app.fetch(req("/test"));
      expect(res.status).toBe(200);
    }
  });

  test("returns 429 when limit exceeded", async () => {
    const app = buildApp(2, 60_000);

    const r1 = await app.fetch(req("/test"));
    expect(r1.status).toBe(200);

    const r2 = await app.fetch(req("/test"));
    expect(r2.status).toBe(200);

    const r3 = await app.fetch(req("/test"));
    expect(r3.status).toBe(429);
    const body = (await r3.json()) as { error: string };
    expect(body.error).toContain("Too many requests");
    expect(r3.headers.get("Retry-After")).toBeTruthy();
  });

  test("tracks IPs independently", async () => {
    const app = buildApp(1, 60_000);

    const r1 = await app.fetch(req("/test", "10.0.0.1"));
    expect(r1.status).toBe(200);

    const r2 = await app.fetch(req("/test", "10.0.0.2"));
    expect(r2.status).toBe(200);

    // First IP should be rate-limited
    const r3 = await app.fetch(req("/test", "10.0.0.1"));
    expect(r3.status).toBe(429);

    // Second IP also exceeded its limit
    const r4 = await app.fetch(req("/test", "10.0.0.2"));
    expect(r4.status).toBe(429);
  });

  test("uses rightmost X-Forwarded-For entry (proxy-set, not client-spoofed)", async () => {
    const app = buildApp(1, 60_000);

    // Client sends spoofed leftmost IP, but proxy appends real IP as rightmost
    const r1 = await app.fetch(req("/test", "1.1.1.1, 10.0.0.1"));
    expect(r1.status).toBe(200);

    // Same real IP (rightmost) should be rate-limited
    const r2 = await app.fetch(req("/test", "2.2.2.2, 10.0.0.1"));
    expect(r2.status).toBe(429);

    // Different real IP should still work
    const r3 = await app.fetch(req("/test", "1.1.1.1, 10.0.0.2"));
    expect(r3.status).toBe(200);
  });

  test("allows requests again after window expires", async () => {
    const app = buildApp(1, 50); // 50ms window

    const r1 = await app.fetch(req("/test"));
    expect(r1.status).toBe(200);

    const r2 = await app.fetch(req("/test"));
    expect(r2.status).toBe(429);

    // Wait for window to expire
    await new Promise((resolve) => setTimeout(resolve, 60));

    const r3 = await app.fetch(req("/test"));
    expect(r3.status).toBe(200);
  });
});
