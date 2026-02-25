import { describe, test, expect, beforeAll, beforeEach, afterAll } from "bun:test";
import { setupEnv, createTestJwt, req } from "./helpers.js";
import { rmSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const TEST_UPLOAD_DIR = join(import.meta.dir, ".test-profile-uploads");
const TEST_DATA_DIR = join(import.meta.dir, ".test-profile-api-data");
const TEST_PROFILE_PATH = join(TEST_DATA_DIR, "profiles.json");

// Set env before any source imports
setupEnv();
process.env.UPLOAD_DIR = TEST_UPLOAD_DIR;
process.env.DATA_DIR = TEST_DATA_DIR;

import { profile } from "../src/routes/profile.js";
import {
  setProfilePath,
  resetProfilePath,
  reloadProfiles,
  setProfile,
} from "../src/profileStore.js";

beforeAll(() => {
  mkdirSync(TEST_UPLOAD_DIR, { recursive: true });
  mkdirSync(TEST_DATA_DIR, { recursive: true });
});

beforeEach(() => {
  // Clean between tests
  if (existsSync(TEST_UPLOAD_DIR)) {
    rmSync(TEST_UPLOAD_DIR, { recursive: true, force: true });
    mkdirSync(TEST_UPLOAD_DIR, { recursive: true });
  }
  if (existsSync(TEST_DATA_DIR)) {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DATA_DIR, { recursive: true });
  }
  setProfilePath(TEST_PROFILE_PATH);
});

afterAll(() => {
  resetProfilePath();
  if (existsSync(TEST_UPLOAD_DIR)) {
    rmSync(TEST_UPLOAD_DIR, { recursive: true, force: true });
  }
  if (existsSync(TEST_DATA_DIR)) {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  }
});

/** Build a multipart/form-data Request with an avatar attached. */
function avatarReq(
  content: Uint8Array,
  opts?: { token?: string; filename?: string },
): Request {
  const blob = new Blob([content], { type: "image/png" });
  const form = new FormData();
  form.append("avatar", blob, opts?.filename ?? "avatar.png");

  const headers: Record<string, string> = {};
  if (opts?.token) {
    headers["Authorization"] = `Bearer ${opts.token}`;
  }

  return req("/api/profile/avatar", {
    method: "POST",
    headers,
    body: form,
  });
}

// --- GET /api/profile/:account ---

describe("GET /api/profile/:account", () => {
  test("returns 404 for non-existent profile", async () => {
    const res = await profile.fetch(req("/api/profile/nobody"));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("not found");
  });

  test("returns profile data for existing profile", async () => {
    setProfile("alice", { displayName: "Alice", bio: "Hello" });

    const res = await profile.fetch(req("/api/profile/alice"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { account: string; displayName: string; bio: string };
    expect(body.account).toBe("alice");
    expect(body.displayName).toBe("Alice");
    expect(body.bio).toBe("Hello");
  });

  test("does not require authentication", async () => {
    setProfile("bob", { displayName: "Bob" });
    const res = await profile.fetch(req("/api/profile/bob"));
    expect(res.status).toBe(200);
  });
});

// --- GET /api/profiles ---

describe("GET /api/profiles", () => {
  test("returns empty array when no profiles exist", async () => {
    const res = await profile.fetch(req("/api/profiles"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(body).toEqual([]);
  });

  test("returns all profiles as array", async () => {
    setProfile("alice", { displayName: "Alice" });
    setProfile("bob", { displayName: "Bob" });

    const res = await profile.fetch(req("/api/profiles"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ account: string; displayName: string }>;
    expect(body.length).toBe(2);
    const names = body.map((p) => p.displayName).sort();
    expect(names).toEqual(["Alice", "Bob"]);
  });

  test("does not require authentication", async () => {
    const res = await profile.fetch(req("/api/profiles"));
    expect(res.status).toBe(200);
  });
});

// --- PUT /api/profile ---

describe("PUT /api/profile", () => {
  test("returns 401 without Authorization header", async () => {
    const r = req("/api/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "Test" }),
    });
    const res = await profile.fetch(r);
    expect(res.status).toBe(401);
  });

  test("returns 401 with invalid JWT", async () => {
    const r = req("/api/profile", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer invalid.token.here",
      },
      body: JSON.stringify({ displayName: "Test" }),
    });
    const res = await profile.fetch(r);
    expect(res.status).toBe(401);
  });

  test("returns 400 for invalid JSON body", async () => {
    const token = await createTestJwt("alice");
    const r = req("/api/profile", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: "not json",
    });
    const res = await profile.fetch(r);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("JSON");
  });

  test("creates profile with display name and bio", async () => {
    const token = await createTestJwt("alice");
    const r = req("/api/profile", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ displayName: "Alice", bio: "Hello world" }),
    });
    const res = await profile.fetch(r);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { account: string; displayName: string; bio: string };
    expect(body.account).toBe("alice");
    expect(body.displayName).toBe("Alice");
    expect(body.bio).toBe("Hello world");
  });

  test("updates existing profile", async () => {
    const token = await createTestJwt("alice");

    // Create
    await profile.fetch(req("/api/profile", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ displayName: "Alice", bio: "Original" }),
    }));

    // Update
    const res = await profile.fetch(req("/api/profile", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ bio: "Updated" }),
    }));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { displayName: string; bio: string };
    expect(body.displayName).toBe("Alice");
    expect(body.bio).toBe("Updated");
  });

  test("rejects non-string field values", async () => {
    const token = await createTestJwt("alice");
    const r = req("/api/profile", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ displayName: 123 }),
    });
    const res = await profile.fetch(r);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("string");
  });

  test("rejects overly long field values", async () => {
    const token = await createTestJwt("alice");
    const r = req("/api/profile", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ bio: "x".repeat(501) }),
    });
    const res = await profile.fetch(r);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("length");
  });

  test("ignores unknown fields", async () => {
    const token = await createTestJwt("alice");
    const r = req("/api/profile", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ displayName: "Alice", hackField: "pwned" }),
    });
    const res = await profile.fetch(r);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.hackField).toBeUndefined();
  });

  test("sets profile for the authenticated user only", async () => {
    const tokenAlice = await createTestJwt("alice");
    const tokenBob = await createTestJwt("bob");

    await profile.fetch(req("/api/profile", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenAlice}`,
      },
      body: JSON.stringify({ displayName: "Alice" }),
    }));

    await profile.fetch(req("/api/profile", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenBob}`,
      },
      body: JSON.stringify({ displayName: "Bob" }),
    }));

    const aliceRes = await profile.fetch(req("/api/profile/alice"));
    const bobRes = await profile.fetch(req("/api/profile/bob"));

    const alice = (await aliceRes.json()) as { displayName: string };
    const bob = (await bobRes.json()) as { displayName: string };

    expect(alice.displayName).toBe("Alice");
    expect(bob.displayName).toBe("Bob");
  });
});

// --- Cross-user tampering ---

describe("cross-user profile isolation", () => {
  test("alice cannot overwrite bob's profile via PUT", async () => {
    const tokenAlice = await createTestJwt("alice");
    const tokenBob = await createTestJwt("bob");

    // Bob creates his profile
    await profile.fetch(req("/api/profile", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenBob}`,
      },
      body: JSON.stringify({ displayName: "Bob Original", bio: "Bob's bio" }),
    }));

    // Alice updates her own profile -- should NOT touch Bob's
    await profile.fetch(req("/api/profile", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenAlice}`,
      },
      body: JSON.stringify({ displayName: "Alice", bio: "Alice's bio" }),
    }));

    // Verify Bob's profile is untouched
    const bobRes = await profile.fetch(req("/api/profile/bob"));
    const bob = (await bobRes.json()) as { displayName: string; bio: string };
    expect(bob.displayName).toBe("Bob Original");
    expect(bob.bio).toBe("Bob's bio");
  });

  test("alice cannot delete bob's profile", async () => {
    const tokenAlice = await createTestJwt("alice");

    // Bob creates his profile
    setProfile("bob", { displayName: "Bob" });

    // Alice attempts to delete (will only delete her own, which doesn't exist)
    const delRes = await profile.fetch(req("/api/profile", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${tokenAlice}` },
    }));
    expect(delRes.status).toBe(404); // Alice has no profile to delete

    // Bob's profile still exists
    const bobRes = await profile.fetch(req("/api/profile/bob"));
    expect(bobRes.status).toBe(200);
    const bob = (await bobRes.json()) as { displayName: string };
    expect(bob.displayName).toBe("Bob");
  });

  test("alice's avatar upload does not affect bob's profile", async () => {
    const tokenAlice = await createTestJwt("alice");

    // Bob creates his profile
    setProfile("bob", { displayName: "Bob", avatar: "/api/files/avatars/old.png" });

    // Alice uploads an avatar
    const pngData = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    const res = await profile.fetch(avatarReq(pngData, { token: tokenAlice }));
    expect(res.status).toBe(200);

    // Bob's avatar is unchanged
    const bobRes = await profile.fetch(req("/api/profile/bob"));
    const bob = (await bobRes.json()) as { avatar: string };
    expect(bob.avatar).toBe("/api/files/avatars/old.png");
  });
});

// --- DELETE /api/profile ---

describe("DELETE /api/profile", () => {
  test("returns 401 without Authorization header", async () => {
    const r = req("/api/profile", { method: "DELETE" });
    const res = await profile.fetch(r);
    expect(res.status).toBe(401);
  });

  test("returns 404 when profile does not exist", async () => {
    const token = await createTestJwt("alice");
    const r = req("/api/profile", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    const res = await profile.fetch(r);
    expect(res.status).toBe(404);
  });

  test("deletes own profile successfully", async () => {
    const token = await createTestJwt("alice");

    // Create profile first
    setProfile("alice", { displayName: "Alice" });

    const r = req("/api/profile", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    const res = await profile.fetch(r);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(true);

    // Verify it's gone
    const getRes = await profile.fetch(req("/api/profile/alice"));
    expect(getRes.status).toBe(404);
  });
});

// --- POST /api/profile/avatar ---

describe("POST /api/profile/avatar", () => {
  test("returns 401 without Authorization header", async () => {
    const pngData = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    const res = await profile.fetch(avatarReq(pngData));
    expect(res.status).toBe(401);
  });

  test("returns 400 when avatar field is missing", async () => {
    const token = await createTestJwt("alice");
    const form = new FormData();
    form.append("notavatar", "some data");

    const res = await profile.fetch(req("/api/profile/avatar", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("avatar");
  });

  test("uploads PNG avatar successfully", async () => {
    const token = await createTestJwt("alice");
    const pngData = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);

    const res = await profile.fetch(avatarReq(pngData, { token }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string };
    expect(body.url).toMatch(/^\/api\/files\/avatars\/[0-9a-f-]+\.png$/);
  });

  test("uploads JPEG avatar successfully", async () => {
    const token = await createTestJwt("alice");
    const jpegData = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

    const res = await profile.fetch(avatarReq(jpegData, { token, filename: "photo.jpg" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string };
    expect(body.url).toMatch(/^\/api\/files\/avatars\/[0-9a-f-]+\.jpg$/);
  });

  test("uploads GIF avatar successfully", async () => {
    const token = await createTestJwt("alice");
    const gifData = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00]);

    const res = await profile.fetch(avatarReq(gifData, { token, filename: "anim.gif" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string };
    expect(body.url).toMatch(/^\/api\/files\/avatars\/[0-9a-f-]+\.gif$/);
  });

  test("uploads WebP avatar successfully", async () => {
    const token = await createTestJwt("alice");
    const webpData = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);

    const res = await profile.fetch(avatarReq(webpData, { token, filename: "pic.webp" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string };
    expect(body.url).toMatch(/^\/api\/files\/avatars\/[0-9a-f-]+\.webp$/);
  });

  test("rejects non-image files", async () => {
    const token = await createTestJwt("alice");
    const textData = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello"

    const res = await profile.fetch(avatarReq(textData, { token, filename: "file.txt" }));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("image type");
  });

  test("rejects PDF files pretending to be images", async () => {
    const token = await createTestJwt("alice");
    const pdfData = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-

    const res = await profile.fetch(avatarReq(pdfData, { token, filename: "doc.pdf" }));
    expect(res.status).toBe(422);
  });

  test("rejects oversized files (>2MB)", async () => {
    const token = await createTestJwt("alice");
    // Create a valid PNG header followed by enough data to exceed 2MB
    const header = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const padding = new Uint8Array(2 * 1024 * 1024 + 1);
    const oversized = new Uint8Array(header.length + padding.length);
    oversized.set(header);
    oversized.set(padding, header.length);

    const res = await profile.fetch(avatarReq(oversized, { token }));
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("large");
  });

  test("updates profile avatar URL after upload", async () => {
    const token = await createTestJwt("alice");
    const pngData = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);

    const uploadRes = await profile.fetch(avatarReq(pngData, { token }));
    expect(uploadRes.status).toBe(200);
    const uploadBody = (await uploadRes.json()) as { url: string };

    // Check profile was updated
    const profileRes = await profile.fetch(req("/api/profile/alice"));
    expect(profileRes.status).toBe(200);
    const profileBody = (await profileRes.json()) as { avatar: string };
    expect(profileBody.avatar).toBe(uploadBody.url);
  });

  test("stores avatar in uploads/avatars/ directory", async () => {
    const token = await createTestJwt("alice");
    const pngData = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);

    await profile.fetch(avatarReq(pngData, { token }));

    const avatarDir = join(TEST_UPLOAD_DIR, "avatars");
    expect(existsSync(avatarDir)).toBe(true);
  });

  test("rejects empty files", async () => {
    const token = await createTestJwt("alice");
    const emptyData = new Uint8Array(0);

    const res = await profile.fetch(avatarReq(emptyData, { token }));
    // Empty file will fail either on size check or magic byte validation
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

// --- GET /api/files/avatars/:filename ---

describe("GET /api/files/avatars/:filename", () => {
  test("serves uploaded avatar with correct Content-Type", async () => {
    const token = await createTestJwt("alice");
    const pngData = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);

    const uploadRes = await profile.fetch(avatarReq(pngData, { token }));
    expect(uploadRes.status).toBe(200);
    const uploadBody = (await uploadRes.json()) as { url: string };

    const serveRes = await profile.fetch(req(uploadBody.url));
    expect(serveRes.status).toBe(200);
    expect(serveRes.headers.get("Content-Type")).toBe("image/png");
    expect(serveRes.headers.get("Cache-Control")).toContain("immutable");
    expect(serveRes.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  test("returns 404 for non-existent avatar", async () => {
    // Ensure avatar dir exists
    mkdirSync(join(TEST_UPLOAD_DIR, "avatars"), { recursive: true });
    const res = await profile.fetch(req("/api/files/avatars/does-not-exist.png"));
    expect(res.status).toBe(404);
  });

  test("returns 400 for directory traversal attempt", async () => {
    const res = await profile.fetch(req("/api/files/avatars/..%2F..%2Fetc%2Fpasswd"));
    expect(res.status).toBe(400);
  });
});
