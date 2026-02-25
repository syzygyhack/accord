import { Hono } from "hono";
import { randomUUID } from "crypto";
import { join, resolve, extname } from "path";
import { mkdir, stat } from "fs/promises";
import { authMiddleware } from "../middleware/auth.js";
import type { AppEnv } from "../types.js";
import { env } from "../env.js";
import { securityLog } from "../securityLog.js";
import {
  getProfile,
  setProfile,
  deleteProfile,
  getAllProfiles,
} from "../profileStore.js";

const profile = new Hono<AppEnv>();

/** Max avatar file size: 2MB. */
const MAX_AVATAR_SIZE = 2 * 1024 * 1024;

/** Allowed avatar extensions with their magic byte signatures. */
const AVATAR_MAGIC: Array<{ ext: string; mime: string; signatures: Uint8Array[] }> = [
  {
    ext: ".png",
    mime: "image/png",
    signatures: [new Uint8Array([0x89, 0x50, 0x4e, 0x47])],
  },
  {
    ext: ".jpg",
    mime: "image/jpeg",
    signatures: [new Uint8Array([0xff, 0xd8, 0xff])],
  },
  {
    ext: ".gif",
    mime: "image/gif",
    signatures: [
      new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]),
      new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]),
    ],
  },
  {
    ext: ".webp",
    mime: "image/webp",
    signatures: [new Uint8Array([0x52, 0x49, 0x46, 0x46])],
  },
];

/** Detect image type from magic bytes. Returns ext + mime or null. */
function detectImageType(header: Uint8Array): { ext: string; mime: string } | null {
  for (const rule of AVATAR_MAGIC) {
    const match = rule.signatures.some((sig) =>
      sig.every((byte, i) => i < header.length && header[i] === byte),
    );
    if (match) return { ext: rule.ext, mime: rule.mime };
  }
  return null;
}

/** Ensure the avatars upload directory exists. */
async function ensureAvatarDir(): Promise<string> {
  const dir = join(env.UPLOAD_DIR, "avatars");
  await mkdir(dir, { recursive: true });
  return dir;
}

// --- Public endpoints ---

/** GET /api/profile/:account — get a single profile */
profile.get("/api/profile/:account", (c) => {
  const account = c.req.param("account");

  if (!account || account.length > 200) {
    return c.json({ error: "Invalid account" }, 400);
  }

  const p = getProfile(account);
  if (!p) {
    return c.json({ error: "Profile not found" }, 404);
  }

  return c.json(p);
});

/** GET /api/profiles — get all profiles (returns array) */
profile.get("/api/profiles", (c) => {
  const all = getAllProfiles();
  return c.json(Object.values(all));
});

// --- Authenticated endpoints ---

/** PUT /api/profile — update own profile */
profile.put("/api/profile", authMiddleware, async (c) => {
  const user = c.get("user");

  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  // Whitelist allowed fields
  const allowed = ["displayName", "bio", "status"] as const;
  const updates: Record<string, string> = {};

  for (const key of allowed) {
    if (key in body) {
      const val = body[key];
      if (val !== undefined && val !== null) {
        if (typeof val !== "string") {
          return c.json({ error: `${key} must be a string` }, 400);
        }
        if (val.length > 500) {
          return c.json({ error: `${key} exceeds maximum length` }, 400);
        }
        updates[key] = val;
      }
    }
  }

  const updated = setProfile(user.sub, updates);
  securityLog("profile.update", { account: user.sub });

  return c.json(updated);
});

/** DELETE /api/profile — delete own profile */
profile.delete("/api/profile", authMiddleware, async (c) => {
  const user = c.get("user");
  const deleted = deleteProfile(user.sub);

  if (!deleted) {
    return c.json({ error: "Profile not found" }, 404);
  }

  securityLog("profile.delete", { account: user.sub });
  return c.json({ success: true });
});

/** POST /api/profile/avatar — upload avatar image */
profile.post("/api/profile/avatar", authMiddleware, async (c) => {
  const contentType = c.req.header("Content-Type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return c.json({ error: "Content-Type must be multipart/form-data" }, 400);
  }

  // Early rejection via Content-Length
  const clHeader = c.req.header("Content-Length");
  if (clHeader) {
    const contentLength = parseInt(clHeader, 10);
    if (!Number.isNaN(contentLength) && contentLength > MAX_AVATAR_SIZE * 1.1) {
      return c.json({ error: "File too large" }, 413);
    }
  }

  const body = await c.req.parseBody();
  const file = body["avatar"];

  if (!file || !(file instanceof File)) {
    return c.json({ error: "Missing avatar field" }, 400);
  }

  if (file.size > MAX_AVATAR_SIZE) {
    return c.json({ error: "File too large" }, 413);
  }

  if (file.size === 0) {
    return c.json({ error: "Empty file" }, 400);
  }

  // Validate magic bytes to determine image type
  const headerSlice = file.slice(0, 12);
  const header = new Uint8Array(await headerSlice.arrayBuffer());
  const imageType = detectImageType(header);

  if (!imageType) {
    return c.json({ error: "Invalid image type. Accepted: jpg, png, gif, webp" }, 422);
  }

  const uuid = randomUUID();
  const storedName = `${uuid}${imageType.ext}`;

  const dir = await ensureAvatarDir();
  const filePath = join(dir, storedName);

  await Bun.write(filePath, file);

  const avatarUrl = `/api/files/avatars/${storedName}`;

  // Update the user's profile with the avatar URL
  const user = c.get("user");
  setProfile(user.sub, { avatar: avatarUrl });
  securityLog("profile.avatar", { account: user.sub, detail: `${file.size}b -> ${storedName}` });

  return c.json({ url: avatarUrl });
});

/** MIME types for avatar images. */
const AVATAR_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

/** GET /api/files/avatars/:filename — serve avatar images (public, no auth) */
profile.get("/api/files/avatars/:filename", async (c) => {
  const filename = c.req.param("filename");

  // Prevent directory traversal
  if (
    filename.includes("..") ||
    filename.includes("/") ||
    filename.includes("\\") ||
    filename.includes("\0")
  ) {
    return c.json({ error: "Invalid filename" }, 400);
  }

  const dir = resolve(join(env.UPLOAD_DIR, "avatars"));
  const filePath = join(dir, filename);

  if (!resolve(filePath).startsWith(dir)) {
    return c.json({ error: "Invalid filename" }, 400);
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      return c.json({ error: "Not found" }, 404);
    }
  } catch {
    return c.json({ error: "Not found" }, 404);
  }

  const file = Bun.file(filePath);
  const ext = extname(filename).toLowerCase();
  const mimeType = AVATAR_MIME[ext] || "application/octet-stream";

  return new Response(file, {
    headers: {
      "Content-Type": mimeType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

export { profile };
