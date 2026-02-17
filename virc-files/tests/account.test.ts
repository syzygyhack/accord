import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { setupEnv, createTestJwt, req, TEST_ERGO_API } from "./helpers.js";

setupEnv();

import { account } from "../src/routes/account.js";

describe("POST /api/account/password", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("returns 401 without Authorization header", async () => {
    const r = req("/api/account/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: "old", newPassword: "new" }),
    });
    const res = await account.fetch(r);
    expect(res.status).toBe(401);
  });

  test("returns 400 when body fields are missing", async () => {
    const token = await createTestJwt("alice");
    const r = req("/api/account/password", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ currentPassword: "old" }),
    });
    const res = await account.fetch(r);
    expect(res.status).toBe(400);
  });

  test("returns 403 when current password is wrong", async () => {
    const token = await createTestJwt("alice");

    globalThis.fetch = mock(async () =>
      new Response(JSON.stringify({ success: false }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const r = req("/api/account/password", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ currentPassword: "wrongpass", newPassword: "newpassword" }),
    });
    const res = await account.fetch(r);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("incorrect");
  });

  test("returns success when password change succeeds", async () => {
    const token = await createTestJwt("alice");

    let callCount = 0;
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      callCount++;
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      if (urlStr.includes("/v1/check_auth")) {
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (urlStr.includes("/v1/ns/set")) {
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("Not found", { status: 404 });
    });

    const r = req("/api/account/password", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ currentPassword: "old-pass", newPassword: "new-pass" }),
    });
    const res = await account.fetch(r);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(true);
    expect(callCount).toBe(2); // check_auth + ns/set
  });

  test("returns 502 when Ergo is unavailable for password verification", async () => {
    const token = await createTestJwt("alice");

    globalThis.fetch = mock(async () => {
      throw new Error("Connection refused");
    });

    const r = req("/api/account/password", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ currentPassword: "old-password", newPassword: "new-password" }),
    });
    const res = await account.fetch(r);
    expect(res.status).toBe(502);
  });
});

describe("POST /api/account/email", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("returns 401 without Authorization header", async () => {
    const r = req("/api/account/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "test@test.com" }),
    });
    const res = await account.fetch(r);
    expect(res.status).toBe(401);
  });

  test("returns 400 when email is missing", async () => {
    const token = await createTestJwt("alice");
    const r = req("/api/account/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({}),
    });
    const res = await account.fetch(r);
    expect(res.status).toBe(400);
  });

  test("returns 400 for invalid email format", async () => {
    const token = await createTestJwt("alice");
    const r = req("/api/account/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ email: "no-at-sign" }),
    });
    const res = await account.fetch(r);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("email");
  });

  test("returns success when email change succeeds", async () => {
    const token = await createTestJwt("alice");

    globalThis.fetch = mock(async () =>
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const r = req("/api/account/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ email: "alice@example.com" }),
    });
    const res = await account.fetch(r);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(true);
  });

  test("returns 502 when Ergo is unavailable", async () => {
    const token = await createTestJwt("alice");

    globalThis.fetch = mock(async () => {
      throw new Error("Connection refused");
    });

    const r = req("/api/account/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ email: "alice@example.com" }),
    });
    const res = await account.fetch(r);
    expect(res.status).toBe(502);
  });
});
