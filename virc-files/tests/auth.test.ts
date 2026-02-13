import { describe, test, expect, beforeAll, afterEach, mock } from "bun:test";
import { jwtVerify } from "jose";
import {
  setupEnv,
  TEST_JWT_SECRET,
  TEST_ERGO_API,
  req,
} from "./helpers.js";

// Set env before any source imports
setupEnv();

// Import after env is set
import { auth } from "../src/routes/auth.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("POST /api/auth", () => {
  test("returns 400 when account or password missing", async () => {
    const res = await auth.fetch(req("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account: "user" }), // no password
    }));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("Missing");
  });

  test("returns 401 when Ergo rejects credentials", async () => {
    globalThis.fetch = mock(async () =>
      new Response(JSON.stringify({ success: false }), { status: 403 }),
    ) as typeof fetch;

    const res = await auth.fetch(req("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account: "bad", password: "wrong" }),
    }));
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("Invalid credentials");
  });

  test("returns 401 when Ergo returns ok but success=false", async () => {
    globalThis.fetch = mock(async () =>
      new Response(JSON.stringify({ success: false }), { status: 200 }),
    ) as typeof fetch;

    const res = await auth.fetch(req("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account: "user", password: "pass" }),
    }));
    expect(res.status).toBe(401);
  });

  test("returns 503 when Ergo is unreachable", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;

    const res = await auth.fetch(req("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account: "user", password: "pass" }),
    }));
    expect(res.status).toBe(503);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("Auth service unavailable");
  });

  test("returns JWT on valid credentials", async () => {
    globalThis.fetch = mock(async () =>
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    ) as typeof fetch;

    const res = await auth.fetch(req("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account: "alice", password: "correct" }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json() as { token: string };
    expect(body.token).toBeDefined();
    expect(typeof body.token).toBe("string");
  });

  test("returned JWT has correct payload shape", async () => {
    globalThis.fetch = mock(async () =>
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    ) as typeof fetch;

    const res = await auth.fetch(req("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account: "alice", password: "correct" }),
    }));
    const { token } = await res.json() as { token: string };

    const secret = new TextEncoder().encode(TEST_JWT_SECRET);
    const { payload } = await jwtVerify(token, secret, { issuer: "virc-files" });

    expect(payload.sub).toBe("alice");
    expect(payload.iss).toBe("virc-files");
    expect(typeof payload.iat).toBe("number");
    expect(typeof payload.exp).toBe("number");
    expect((payload as Record<string, unknown>).srv).toBe("virc.local");
  });

  test("returned JWT can be verified with the same secret", async () => {
    globalThis.fetch = mock(async () =>
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    ) as typeof fetch;

    const res = await auth.fetch(req("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account: "bob", password: "secret" }),
    }));
    const { token } = await res.json() as { token: string };

    const secret = new TextEncoder().encode(TEST_JWT_SECRET);
    // Should not throw
    const { payload } = await jwtVerify(token, secret, { issuer: "virc-files" });
    expect(payload.sub).toBe("bob");
  });

  test("returns 403 when Origin does not match ALLOWED_ORIGIN", async () => {
    const prev = process.env.ALLOWED_ORIGIN;
    process.env.ALLOWED_ORIGIN = "https://virc.example.com";
    try {
      const res = await auth.fetch(req("/api/auth", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://evil.example.com",
        },
        body: JSON.stringify({ account: "alice", password: "pass" }),
      }));
      expect(res.status).toBe(403);
      const body = await res.json() as { error: string };
      expect(body.error).toContain("Origin");
    } finally {
      if (prev === undefined) delete process.env.ALLOWED_ORIGIN;
      else process.env.ALLOWED_ORIGIN = prev;
    }
  });

  test("allows request when Origin matches ALLOWED_ORIGIN", async () => {
    const prev = process.env.ALLOWED_ORIGIN;
    process.env.ALLOWED_ORIGIN = "https://virc.example.com";
    globalThis.fetch = mock(async () =>
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    ) as typeof fetch;
    try {
      const res = await auth.fetch(req("/api/auth", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://virc.example.com",
        },
        body: JSON.stringify({ account: "alice", password: "pass" }),
      }));
      expect(res.status).toBe(200);
    } finally {
      if (prev === undefined) delete process.env.ALLOWED_ORIGIN;
      else process.env.ALLOWED_ORIGIN = prev;
    }
  });

  test("sends correct request to Ergo API", async () => {
    const fetchMock = mock(async () =>
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    await auth.fetch(req("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account: "alice", password: "pass123" }),
    }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(`${TEST_ERGO_API}/v1/check_auth`);
    expect(options.method).toBe("POST");
    const sentBody = JSON.parse(options.body as string);
    expect(sentBody.accountName).toBe("alice");
    expect(sentBody.passphrase).toBe("pass123");
  });
});
