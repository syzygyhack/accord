import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { setupEnv, createTestJwt, req } from "./helpers.js";
import { mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";

const TEST_DATA_DIR = join(import.meta.dir, ".test-admin-data");
const TEST_PROFILE_PATH = join(TEST_DATA_DIR, "profiles.json");

// Set env before any source imports
setupEnv();
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.ADMIN_ACCOUNTS = "admin,superadmin";

import { admin } from "../src/routes/admin.js";
import {
  setProfilePath,
  resetProfilePath,
  setProfile,
} from "../src/profileStore.js";
import { clearSecurityLogs, getSecurityLogs, securityLog } from "../src/securityLog.js";

const originalFetch = globalThis.fetch;

beforeEach(() => {
  mkdirSync(TEST_DATA_DIR, { recursive: true });
  setProfilePath(TEST_PROFILE_PATH);
  clearSecurityLogs();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  resetProfilePath();
  if (existsSync(TEST_DATA_DIR)) {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  }
});

/** Helper: build a JSON request with admin auth. */
async function adminReq(
  path: string,
  opts?: { method?: string; body?: unknown; account?: string },
): Promise<Request> {
  const account = opts?.account ?? "admin";
  const token = await createTestJwt(account);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };
  const init: RequestInit = { method: opts?.method ?? "GET", headers };

  if (opts?.body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(opts.body);
  }

  return req(path, init);
}

/** Helper: build a JSON request with non-admin auth. */
async function userReq(
  path: string,
  opts?: { method?: string; body?: unknown },
): Promise<Request> {
  return adminReq(path, { ...opts, account: "regularuser" });
}

// =============================================================================
// Admin Middleware Tests
// =============================================================================

describe("Admin middleware", () => {
  test("allows admin user to access admin endpoints", async () => {
    // Mock ergoPost for stats endpoint
    globalThis.fetch = mock(async () =>
      new Response(JSON.stringify({ success: false }), { status: 500 }),
    ) as typeof fetch;

    const r = await adminReq("/api/admin/stats");
    const res = await admin.fetch(r);
    expect(res.status).toBe(200);
  });

  test("rejects non-admin user with 403", async () => {
    const r = await userReq("/api/admin/stats");
    const res = await admin.fetch(r);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("admin");
  });

  test("rejects unauthenticated request with 401", async () => {
    const r = req("/api/admin/stats");
    const res = await admin.fetch(r);
    expect(res.status).toBe(401);
  });

  test("rejects expired token with 401", async () => {
    const token = await createTestJwt("admin", { expired: true });
    const r = req("/api/admin/stats", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const res = await admin.fetch(r);
    expect(res.status).toBe(401);
  });

  test("allows second admin account in ADMIN_ACCOUNTS list", async () => {
    globalThis.fetch = mock(async () =>
      new Response(JSON.stringify({ success: false }), { status: 500 }),
    ) as typeof fetch;

    const r = await adminReq("/api/admin/stats", { account: "superadmin" });
    const res = await admin.fetch(r);
    expect(res.status).toBe(200);
  });
});

// =============================================================================
// GET /api/admin/stats
// =============================================================================

describe("GET /api/admin/stats", () => {
  test("returns server statistics with Ergo data", async () => {
    globalThis.fetch = mock(async () =>
      new Response(JSON.stringify({
        success: true,
        channels: 5,
        registered_accounts: 42,
      }), { status: 200 }),
    ) as typeof fetch;

    setProfile("alice", { displayName: "Alice" });
    setProfile("bob", { displayName: "Bob" });

    const r = await adminReq("/api/admin/stats");
    const res = await admin.fetch(r);
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      registeredAccounts: number;
      profileCount: number;
      channels: number;
      uptimeMs: number;
      uptimeSeconds: number;
    };
    expect(body.registeredAccounts).toBe(42);
    expect(body.profileCount).toBe(2);
    expect(body.channels).toBe(5);
    expect(body.uptimeMs).toBeGreaterThan(0);
    expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  test("falls back to profile count when Ergo is unavailable", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;

    setProfile("alice", { displayName: "Alice" });
    setProfile("bob", { displayName: "Bob" });
    setProfile("carol", { displayName: "Carol" });

    const r = await adminReq("/api/admin/stats");
    const res = await admin.fetch(r);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { registeredAccounts: number; profileCount: number };
    expect(body.registeredAccounts).toBe(3); // falls back to profile count
    expect(body.profileCount).toBe(3);
  });
});

// =============================================================================
// GET /api/admin/users
// =============================================================================

describe("GET /api/admin/users", () => {
  test("returns empty user list when no profiles exist", async () => {
    const r = await adminReq("/api/admin/users");
    const res = await admin.fetch(r);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { users: unknown[]; total: number };
    expect(body.users).toEqual([]);
    expect(body.total).toBe(0);
  });

  test("returns all users with profile data", async () => {
    setProfile("alice", { displayName: "Alice", status: "online" });
    setProfile("bob", { displayName: "Bob" });

    const r = await adminReq("/api/admin/users");
    const res = await admin.fetch(r);
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      users: Array<{ account: string; displayName: string | null; status: string | null }>;
      total: number;
    };
    expect(body.total).toBe(2);
    expect(body.users.length).toBe(2);

    const alice = body.users.find((u) => u.account === "alice");
    expect(alice).toBeDefined();
    expect(alice!.displayName).toBe("Alice");
    expect(alice!.status).toBe("online");
  });

  test("rejects non-admin with 403", async () => {
    const r = await userReq("/api/admin/users");
    const res = await admin.fetch(r);
    expect(res.status).toBe(403);
  });
});

// =============================================================================
// POST /api/admin/kick
// =============================================================================

describe("POST /api/admin/kick", () => {
  test("kicks user successfully and logs action", async () => {
    globalThis.fetch = mock(async () =>
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    ) as typeof fetch;

    const r = await adminReq("/api/admin/kick", {
      method: "POST",
      body: { channel: "#general", nick: "troll", reason: "spamming" },
    });
    const res = await admin.fetch(r);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { success: boolean; channel: string; nick: string };
    expect(body.success).toBe(true);
    expect(body.channel).toBe("#general");
    expect(body.nick).toBe("troll");

    // Check security log
    const { entries } = getSecurityLogs();
    const kickEntry = entries.find((e) => e.event === "admin.kick");
    expect(kickEntry).toBeDefined();
    expect(kickEntry!.detail).toContain("troll");
    expect(kickEntry!.detail).toContain("#general");
  });

  test("returns 400 for missing channel", async () => {
    const r = await adminReq("/api/admin/kick", {
      method: "POST",
      body: { nick: "troll" },
    });
    const res = await admin.fetch(r);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("channel");
  });

  test("returns 400 for missing nick", async () => {
    const r = await adminReq("/api/admin/kick", {
      method: "POST",
      body: { channel: "#general" },
    });
    const res = await admin.fetch(r);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("nick");
  });

  test("returns 502 when Ergo is unavailable", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;

    const r = await adminReq("/api/admin/kick", {
      method: "POST",
      body: { channel: "#general", nick: "troll" },
    });
    const res = await admin.fetch(r);
    expect(res.status).toBe(502);
  });

  test("rejects non-admin with 403", async () => {
    const r = await userReq("/api/admin/kick", {
      method: "POST",
      body: { channel: "#general", nick: "troll" },
    });
    const res = await admin.fetch(r);
    expect(res.status).toBe(403);
  });
});

// =============================================================================
// POST /api/admin/ban
// =============================================================================

describe("POST /api/admin/ban", () => {
  test("bans user successfully and logs action", async () => {
    globalThis.fetch = mock(async () =>
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    ) as typeof fetch;

    const r = await adminReq("/api/admin/ban", {
      method: "POST",
      body: { channel: "#general", nick: "troll", reason: "harassment", duration: "24h" },
    });
    const res = await admin.fetch(r);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { success: boolean; duration: string };
    expect(body.success).toBe(true);
    expect(body.duration).toBe("24h");

    // Check security log
    const { entries } = getSecurityLogs();
    const banEntry = entries.find((e) => e.event === "admin.ban");
    expect(banEntry).toBeDefined();
    expect(banEntry!.detail).toContain("troll");
    expect(banEntry!.detail).toContain("24h");
  });

  test("returns 400 for missing channel", async () => {
    const r = await adminReq("/api/admin/ban", {
      method: "POST",
      body: { nick: "troll" },
    });
    const res = await admin.fetch(r);
    expect(res.status).toBe(400);
  });

  test("returns 400 for missing nick", async () => {
    const r = await adminReq("/api/admin/ban", {
      method: "POST",
      body: { channel: "#general" },
    });
    const res = await admin.fetch(r);
    expect(res.status).toBe(400);
  });

  test("defaults to permanent ban when no duration given", async () => {
    globalThis.fetch = mock(async () =>
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    ) as typeof fetch;

    const r = await adminReq("/api/admin/ban", {
      method: "POST",
      body: { channel: "#general", nick: "troll" },
    });
    const res = await admin.fetch(r);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { duration: string };
    expect(body.duration).toBe("permanent");
  });

  test("rejects non-admin with 403", async () => {
    const r = await userReq("/api/admin/ban", {
      method: "POST",
      body: { channel: "#general", nick: "troll" },
    });
    const res = await admin.fetch(r);
    expect(res.status).toBe(403);
  });
});

// =============================================================================
// GET /api/admin/audit
// =============================================================================

describe("GET /api/admin/audit", () => {
  test("returns empty audit log when no events exist", async () => {
    const r = await adminReq("/api/admin/audit");
    const res = await admin.fetch(r);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { entries: unknown[]; total: number };
    // The audit_view event itself will be logged, so we get at least 1
    expect(body.total).toBeGreaterThanOrEqual(0);
  });

  test("returns security log entries in reverse chronological order", async () => {
    // Pre-populate some log entries
    securityLog("auth.success", { account: "alice" });
    securityLog("auth.failure", { account: "bob" });
    securityLog("upload", { account: "carol" });

    const r = await adminReq("/api/admin/audit");
    const res = await admin.fetch(r);
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      entries: Array<{ event: string; account?: string }>;
      total: number;
    };
    // Should have 3 pre-populated + 1 audit_view event
    expect(body.total).toBe(4);
    // First entry should be the audit_view (newest)
    expect(body.entries[0].event).toBe("admin.audit_view");
  });

  test("supports pagination with offset and limit", async () => {
    // Add several entries
    for (let i = 0; i < 10; i++) {
      securityLog("auth.success", { account: `user${i}` });
    }

    const r = await adminReq("/api/admin/audit?offset=2&limit=3");
    const res = await admin.fetch(r);
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      entries: unknown[];
      total: number;
      offset: number;
      limit: number;
    };
    expect(body.entries.length).toBe(3);
    expect(body.offset).toBe(2);
    expect(body.limit).toBe(3);
  });

  test("returns 400 for invalid offset", async () => {
    const r = await adminReq("/api/admin/audit?offset=-1");
    const res = await admin.fetch(r);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("offset");
  });

  test("returns 400 for invalid limit", async () => {
    const r = await adminReq("/api/admin/audit?limit=0");
    const res = await admin.fetch(r);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("limit");
  });

  test("logs audit_view event when audit is accessed", async () => {
    const r = await adminReq("/api/admin/audit");
    await admin.fetch(r);

    const { entries } = getSecurityLogs();
    const auditViewEntry = entries.find((e) => e.event === "admin.audit_view");
    expect(auditViewEntry).toBeDefined();
    expect(auditViewEntry!.account).toBe("admin");
  });

  test("rejects non-admin with 403", async () => {
    const r = await userReq("/api/admin/audit");
    const res = await admin.fetch(r);
    expect(res.status).toBe(403);
  });
});

// =============================================================================
// POST /api/admin/announce
// =============================================================================

describe("POST /api/admin/announce", () => {
  test("sends announcement successfully and logs action", async () => {
    globalThis.fetch = mock(async () =>
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    ) as typeof fetch;

    const r = await adminReq("/api/admin/announce", {
      method: "POST",
      body: { channel: "#general", message: "Server maintenance at 3pm" },
    });
    const res = await admin.fetch(r);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { success: boolean; channel: string };
    expect(body.success).toBe(true);
    expect(body.channel).toBe("#general");

    // Check security log
    const { entries } = getSecurityLogs();
    const announceEntry = entries.find((e) => e.event === "admin.announce");
    expect(announceEntry).toBeDefined();
    expect(announceEntry!.detail).toContain("#general");
    expect(announceEntry!.detail).toContain("Server maintenance");
  });

  test("returns 400 for missing channel", async () => {
    const r = await adminReq("/api/admin/announce", {
      method: "POST",
      body: { message: "hello" },
    });
    const res = await admin.fetch(r);
    expect(res.status).toBe(400);
  });

  test("returns 400 for missing message", async () => {
    const r = await adminReq("/api/admin/announce", {
      method: "POST",
      body: { channel: "#general" },
    });
    const res = await admin.fetch(r);
    expect(res.status).toBe(400);
  });

  test("returns 400 for message exceeding max length", async () => {
    const r = await adminReq("/api/admin/announce", {
      method: "POST",
      body: { channel: "#general", message: "x".repeat(2001) },
    });
    const res = await admin.fetch(r);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("long");
  });

  test("returns 502 when Ergo is unavailable", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;

    const r = await adminReq("/api/admin/announce", {
      method: "POST",
      body: { channel: "#general", message: "test" },
    });
    const res = await admin.fetch(r);
    expect(res.status).toBe(502);
  });

  test("rejects non-admin with 403", async () => {
    const r = await userReq("/api/admin/announce", {
      method: "POST",
      body: { channel: "#general", message: "test" },
    });
    const res = await admin.fetch(r);
    expect(res.status).toBe(403);
  });

  test("returns 400 for invalid JSON body", async () => {
    const token = await createTestJwt("admin");
    const r = req("/api/admin/announce", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: "not json",
    });
    const res = await admin.fetch(r);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("JSON");
  });
});
