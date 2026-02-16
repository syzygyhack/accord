import { describe, test, expect, beforeEach, mock } from "bun:test";
import { setupEnv, createTestJwt, req, TEST_ERGO_API } from "./helpers.js";

setupEnv();

import { accountInfo } from "../src/routes/accountInfo.js";

describe("GET /api/account-info", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  test("returns 401 without Authorization header", async () => {
    const r = req("/api/account-info?account=alice");
    const res = await accountInfo.fetch(r);
    expect(res.status).toBe(401);
  });

  test("returns 401 with expired JWT", async () => {
    const token = await createTestJwt("alice", { expired: true });
    const r = req("/api/account-info?account=alice", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const res = await accountInfo.fetch(r);
    expect(res.status).toBe(401);
  });

  test("returns 400 when account parameter is missing", async () => {
    const token = await createTestJwt("alice");
    const r = req("/api/account-info", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const res = await accountInfo.fetch(r);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("account");
  });

  test("returns 400 when account parameter is empty", async () => {
    const token = await createTestJwt("alice");
    const r = req("/api/account-info?account=", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const res = await accountInfo.fetch(r);
    expect(res.status).toBe(400);
  });

  test("returns account info on success", async () => {
    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({
          success: true,
          accountName: "alice",
          registeredAt: "2026-01-15T10:30:00.000Z",
          email: "alice@example.com",
          channels: ["#general", "#dev"],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    try {
      const token = await createTestJwt("alice");
      const r = req("/api/account-info?account=alice", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const res = await accountInfo.fetch(r);
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        accountName: string;
        registeredAt: string;
      };
      expect(body.accountName).toBe("alice");
      expect(body.registeredAt).toBe("2026-01-15T10:30:00.000Z");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("proxies to Ergo /v1/ns/info with correct body", async () => {
    let capturedUrl = "";
    let capturedBody = "";
    let capturedHeaders: Record<string, string> = {};

    globalThis.fetch = mock(async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedBody = init.body as string;
      capturedHeaders = init.headers as Record<string, string>;
      return new Response(
        JSON.stringify({
          success: true,
          accountName: "bob",
          registeredAt: "2025-06-01T00:00:00.000Z",
          email: "",
          channels: [],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    try {
      const token = await createTestJwt("alice");
      const r = req("/api/account-info?account=bob", {
        headers: { Authorization: `Bearer ${token}` },
      });
      await accountInfo.fetch(r);

      expect(capturedUrl).toBe(`${TEST_ERGO_API}/v1/ns/info`);
      expect(JSON.parse(capturedBody)).toEqual({ accountName: "bob" });
      expect(capturedHeaders["Authorization"]).toBe("Bearer test-ergo-api-token");
      expect(capturedHeaders["Content-Type"]).toBe("application/json");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("returns 502 when Ergo is unavailable", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("Connection refused");
    });

    try {
      const token = await createTestJwt("alice");
      const r = req("/api/account-info?account=alice", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const res = await accountInfo.fetch(r);
      expect(res.status).toBe(502);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain("unavailable");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("returns 404 when Ergo says account not found", async () => {
    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({ success: false, error: "Account not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      ),
    );

    try {
      const token = await createTestJwt("alice");
      const r = req("/api/account-info?account=unknown", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const res = await accountInfo.fetch(r);
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain("not found");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("does not expose email in response", async () => {
    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({
          success: true,
          accountName: "alice",
          registeredAt: "2026-01-15T10:30:00.000Z",
          email: "secret@example.com",
          channels: ["#general"],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    try {
      const token = await createTestJwt("alice");
      const r = req("/api/account-info?account=alice", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const res = await accountInfo.fetch(r);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).not.toHaveProperty("email");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
