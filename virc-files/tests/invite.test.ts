import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setupEnv, createTestJwt, req } from "./helpers.js";

setupEnv();

import { createInviteRouter, type InviteStore } from "../src/routes/invite.js";

let dataDir: string;
let invite: ReturnType<typeof createInviteRouter>["router"];
let store: InviteStore;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "accord-invite-test-"));
  const result = createInviteRouter(dataDir);
  invite = result.router;
  store = result.store;
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

/** Helper to make an authenticated POST to create an invite. */
async function createInvite(
  body: object,
  opts?: { token?: string },
): Promise<Response> {
  const token = opts?.token ?? (await createTestJwt("admin"));
  return invite.fetch(
    req("/api/invite", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }),
  );
}

/** Helper to GET an invite token (no auth). */
async function getInvite(token: string): Promise<Response> {
  return invite.fetch(req(`/api/invite/${token}`));
}

/** Helper to POST to redeem an invite (auth required). */
async function redeemInvite(
  token: string,
  opts?: { jwt?: string },
): Promise<Response> {
  const jwt = opts?.jwt ?? (await createTestJwt("admin"));
  return invite.fetch(
    req(`/api/invite/${token}/redeem`, {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}` },
    }),
  );
}

/** Helper to DELETE an invite token (auth required). */
async function deleteInvite(
  token: string,
  opts?: { jwt?: string },
): Promise<Response> {
  const jwt = opts?.jwt ?? (await createTestJwt("admin"));
  return invite.fetch(
    req(`/api/invite/${token}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${jwt}` },
    }),
  );
}

// --- GET /api/invite (list all) ---

describe("GET /api/invite (list)", () => {
  test("returns 401 without auth", async () => {
    const res = await invite.fetch(req("/api/invite"));
    expect(res.status).toBe(401);
  });

  test("returns empty list when no invites exist", async () => {
    const jwt = await createTestJwt("admin");
    const res = await invite.fetch(
      req("/api/invite", {
        headers: { Authorization: `Bearer ${jwt}` },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { invites: unknown[] };
    expect(body.invites).toEqual([]);
  });

  test("returns all invites with status fields", async () => {
    // Create two invites
    await createInvite({ channel: "#general" });
    await createInvite({ channel: "#dev", maxUses: 5 });

    const jwt = await createTestJwt("admin");
    const res = await invite.fetch(
      req("/api/invite", {
        headers: { Authorization: `Bearer ${jwt}` },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      invites: Array<{
        token: string;
        channel: string;
        createdBy: string;
        expiresAt: number;
        maxUses: number;
        useCount: number;
        expired: boolean;
        maxUsesReached: boolean;
      }>;
    };
    expect(body.invites).toHaveLength(2);
    expect(body.invites[0].channel).toBe("#general");
    expect(body.invites[0].expired).toBe(false);
    expect(body.invites[0].maxUsesReached).toBe(false);
    expect(body.invites[1].channel).toBe("#dev");
    expect(body.invites[1].maxUses).toBe(5);
  });

  test("marks expired invites correctly", async () => {
    const createRes = await createInvite({ channel: "#general" });
    const { token } = (await createRes.json()) as { token: string };

    // Manually expire the invite
    const invites = store.getAll();
    const inv = invites.find((i) => i.token === token);
    inv!.expiresAt = Date.now() - 1000;

    const jwt = await createTestJwt("admin");
    const res = await invite.fetch(
      req("/api/invite", {
        headers: { Authorization: `Bearer ${jwt}` },
      }),
    );
    const body = (await res.json()) as {
      invites: Array<{ expired: boolean }>;
    };
    expect(body.invites[0].expired).toBe(true);
  });
});

// --- POST /api/invite ---

describe("POST /api/invite", () => {
  test("returns 401 without auth", async () => {
    const res = await invite.fetch(
      req("/api/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: "#general" }),
      }),
    );
    expect(res.status).toBe(401);
  });

  test("returns 400 when channel is missing", async () => {
    const res = await createInvite({});
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("channel");
  });

  test("creates invite with defaults", async () => {
    const res = await createInvite({ channel: "#general" });
    expect(res.status).toBe(201);

    const body = (await res.json()) as {
      token: string;
      url: string;
      channel: string;
      expiresAt: number;
      maxUses: number;
    };
    expect(body.token).toMatch(/^[a-zA-Z0-9]{12}$/);
    expect(body.channel).toBe("#general");
    expect(body.maxUses).toBe(0);
    expect(body.url).toContain(body.token);
    // Default expiry is 7 days from now
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const diff = body.expiresAt - Date.now();
    expect(diff).toBeGreaterThan(sevenDaysMs - 5000);
    expect(diff).toBeLessThanOrEqual(sevenDaysMs);
  });

  test("creates invite with custom expiry and max uses", async () => {
    const res = await createInvite({
      channel: "#events",
      expiresIn: "1d",
      maxUses: 5,
    });
    expect(res.status).toBe(201);

    const body = (await res.json()) as {
      token: string;
      channel: string;
      expiresAt: number;
      maxUses: number;
    };
    expect(body.channel).toBe("#events");
    expect(body.maxUses).toBe(5);
    const oneDayMs = 24 * 60 * 60 * 1000;
    const diff = body.expiresAt - Date.now();
    expect(diff).toBeGreaterThan(oneDayMs - 5000);
    expect(diff).toBeLessThanOrEqual(oneDayMs);
  });

  test("creates invite with no expiry", async () => {
    const res = await createInvite({
      channel: "#general",
      expiresIn: "never",
    });
    expect(res.status).toBe(201);

    const body = (await res.json()) as { expiresAt: number };
    expect(body.expiresAt).toBe(0);
  });

  test("persists invite to disk", async () => {
    await createInvite({ channel: "#general" });
    const raw = await readFile(join(dataDir, "invites.json"), "utf-8");
    const data = JSON.parse(raw) as Array<{ channel: string }>;
    expect(data).toHaveLength(1);
    expect(data[0].channel).toBe("#general");
  });
});

// --- GET /api/invite/:token ---

describe("GET /api/invite/:token", () => {
  test("returns channel info for valid invite", async () => {
    const createRes = await createInvite({ channel: "#general" });
    const { token } = (await createRes.json()) as { token: string };

    const res = await getInvite(token);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { channel: string; server: string };
    expect(body.channel).toBe("#general");
    expect(body.server).toBeTruthy();
  });

  test("does not increment use count on GET (idempotent)", async () => {
    const createRes = await createInvite({ channel: "#general" });
    const { token } = (await createRes.json()) as { token: string };

    await getInvite(token);
    await getInvite(token);

    // GET should not consume uses
    const invites = store.getAll();
    const inv = invites.find((i) => i.token === token);
    expect(inv?.useCount).toBe(0);
  });

  test("increments use count on POST redeem", async () => {
    const createRes = await createInvite({ channel: "#general" });
    const { token } = (await createRes.json()) as { token: string };

    await redeemInvite(token);
    await redeemInvite(token);

    const invites = store.getAll();
    const inv = invites.find((i) => i.token === token);
    expect(inv?.useCount).toBe(2);
  });

  test("returns 404 for unknown token", async () => {
    const res = await getInvite("nonexistent12");
    expect(res.status).toBe(404);
  });

  test("returns 410 for expired invite", async () => {
    // Create an invite, then manually expire it
    const createRes = await createInvite({ channel: "#general" });
    const { token } = (await createRes.json()) as { token: string };

    // Directly mutate the store to set expired timestamp
    const invites = store.getAll();
    const inv = invites.find((i) => i.token === token);
    inv!.expiresAt = Date.now() - 1000; // expired 1s ago
    await store.save();

    const res = await getInvite(token);
    expect(res.status).toBe(410);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("expired");
  });

  test("returns 410 when max uses reached (via redeem)", async () => {
    const createRes = await createInvite({
      channel: "#general",
      maxUses: 2,
    });
    const { token } = (await createRes.json()) as { token: string };

    // Redeem twice (consumes uses)
    const r1 = await redeemInvite(token);
    expect(r1.status).toBe(200);
    const r2 = await redeemInvite(token);
    expect(r2.status).toBe(200);

    // GET should report exhausted
    const r3 = await getInvite(token);
    expect(r3.status).toBe(410);
    const body = (await r3.json()) as { error: string };
    expect(body.error).toContain("uses");

    // Redeem should also fail
    const r4 = await redeemInvite(token);
    expect(r4.status).toBe(410);
  });

  test("unlimited uses when maxUses is 0", async () => {
    const createRes = await createInvite({
      channel: "#general",
      maxUses: 0,
    });
    const { token } = (await createRes.json()) as { token: string };

    // Should work many times
    for (let i = 0; i < 10; i++) {
      const res = await getInvite(token);
      expect(res.status).toBe(200);
    }
  });
});

// --- DELETE /api/invite/:token ---

describe("DELETE /api/invite/:token", () => {
  test("returns 401 without auth", async () => {
    const res = await invite.fetch(
      req("/api/invite/sometoken123", { method: "DELETE" }),
    );
    expect(res.status).toBe(401);
  });

  test("deletes existing invite", async () => {
    const createRes = await createInvite({ channel: "#general" });
    const { token } = (await createRes.json()) as { token: string };

    const delRes = await deleteInvite(token);
    expect(delRes.status).toBe(200);

    // Should no longer be accessible
    const getRes = await getInvite(token);
    expect(getRes.status).toBe(404);
  });

  test("returns 404 for unknown token", async () => {
    const res = await deleteInvite("nonexistent12");
    expect(res.status).toBe(404);
  });

  test("returns 403 when non-creator tries to delete", async () => {
    // Create invite as "admin"
    const adminJwt = await createTestJwt("admin");
    const createRes = await createInvite({ channel: "#general" }, { token: adminJwt });
    const { token } = (await createRes.json()) as { token: string };

    // Try to delete as "other-user" — should be forbidden
    const otherJwt = await createTestJwt("other-user");
    const delRes = await deleteInvite(token, { jwt: otherJwt });
    expect(delRes.status).toBe(403);
    const body = (await delRes.json()) as { error: string };
    expect(body.error).toContain("Forbidden");

    // Invite should still exist
    const getRes = await getInvite(token);
    expect(getRes.status).toBe(200);
  });

  test("creator can delete after non-creator is denied", async () => {
    const adminJwt = await createTestJwt("admin");
    const createRes = await createInvite({ channel: "#secure" }, { token: adminJwt });
    const { token } = (await createRes.json()) as { token: string };

    // Non-creator denied
    const otherJwt = await createTestJwt("intruder");
    const deny = await deleteInvite(token, { jwt: otherJwt });
    expect(deny.status).toBe(403);

    // Creator succeeds
    const delRes = await deleteInvite(token, { jwt: adminJwt });
    expect(delRes.status).toBe(200);

    // Invite gone
    const getRes = await getInvite(token);
    expect(getRes.status).toBe(404);
  });
});
