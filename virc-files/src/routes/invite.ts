import { Hono } from "hono";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { authMiddleware } from "../middleware/auth.js";
import { env } from "../env.js";
import type { AppEnv } from "../types.js";

// --- Types ---

interface Invite {
  token: string;
  server: string;
  channel: string;
  createdBy: string;
  expiresAt: number; // Unix ms, 0 = never
  maxUses: number; // 0 = unlimited
  useCount: number;
}

// --- Store ---

export class InviteStore {
  private invites: Invite[] = [];
  private filePath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(dataDir: string) {
    this.filePath = join(dataDir, "invites.json");
  }

  /** Load invites from disk. Creates empty file if missing. */
  async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, "utf-8");
      this.invites = JSON.parse(raw) as Invite[];
    } catch {
      this.invites = [];
    }
  }

  /** Persist invites to disk using atomic write (write tmp + rename).
   *  Serialized via writeQueue to prevent concurrent writes from racing. */
  async save(): Promise<void> {
    this.writeQueue = this.writeQueue.then(() => this._doSave()).catch((err) => {
      console.error("[accord] InviteStore save failed:", err);
      throw err; // Propagate so callers know the save failed
    });
    await this.writeQueue;
  }

  private async _doSave(): Promise<void> {
    const dir = dirname(this.filePath);
    await mkdir(dir, { recursive: true });
    const tmp = this.filePath + ".tmp";
    await writeFile(tmp, JSON.stringify(this.invites, null, 2), "utf-8");
    await rename(tmp, this.filePath);
  }

  getAll(): Invite[] {
    return this.invites;
  }

  findByToken(token: string): Invite | undefined {
    return this.invites.find((i) => i.token === token);
  }

  add(invite: Invite): void {
    this.invites.push(invite);
  }

  remove(token: string): boolean {
    const idx = this.invites.findIndex((i) => i.token === token);
    if (idx === -1) return false;
    this.invites.splice(idx, 1);
    return true;
  }
}

// --- Helpers ---

/** Generate a 12-char alphanumeric token using rejection sampling to avoid modulo bias. */
function generateToken(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  // Largest multiple of 62 that fits in a byte: 62 * 4 = 248
  const maxValid = 248;
  let result = "";

  while (result.length < 12) {
    const bytes = randomBytes(16); // over-fetch to reduce iterations
    for (let i = 0; i < bytes.length && result.length < 12; i++) {
      if (bytes[i] < maxValid) {
        result += chars[bytes[i] % chars.length];
      }
    }
  }

  return result;
}

/** Parse duration string like "7d", "1h", "30m" to milliseconds. Returns 0 for "never". Returns null for invalid. */
function parseDuration(duration: string): number | null {
  if (duration === "never" || duration === "0") return 0;

  const match = duration.match(/^(\d+)([dhm])$/);
  if (!match) return null;

  const value = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case "d":
      return value * 24 * 60 * 60 * 1000;
    case "h":
      return value * 60 * 60 * 1000;
    case "m":
      return value * 60 * 1000;
    default:
      return null;
  }
}

/** Check if an invite is expired. */
function isExpired(invite: Invite): boolean {
  return invite.expiresAt !== 0 && Date.now() > invite.expiresAt;
}

/** Check if an invite has exceeded max uses. */
function isMaxUsesReached(invite: Invite): boolean {
  return invite.maxUses > 0 && invite.useCount >= invite.maxUses;
}

// --- Router factory ---

export function createInviteRouter(dataDir?: string) {
  const dir = dataDir ?? env.DATA_DIR;
  const store = new InviteStore(dir);
  const router = new Hono<AppEnv>();

  // Ensure store is loaded before handling requests.
  // Uses a shared promise to prevent concurrent loads from racing.
  let loadPromise: Promise<void> | null = null;
  async function ensureLoaded() {
    if (!loadPromise) {
      loadPromise = store.load();
    }
    await loadPromise;
  }

  // GET /api/invite — list all invites (auth required)
  router.get("/api/invite", authMiddleware, async (c) => {
    await ensureLoaded();

    const invites = store.getAll().map((inv) => ({
      token: inv.token,
      channel: inv.channel,
      createdBy: inv.createdBy,
      expiresAt: inv.expiresAt,
      maxUses: inv.maxUses,
      useCount: inv.useCount,
      expired: isExpired(inv),
      maxUsesReached: isMaxUsesReached(inv),
    }));

    return c.json({ invites });
  });

  // POST /api/invite — create invite (auth required)
  router.post("/api/invite", authMiddleware, async (c) => {
    await ensureLoaded();

    let body: { channel?: string; expiresIn?: string; maxUses?: number };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    if (!body.channel) {
      return c.json({ error: "Missing required field: channel" }, 400);
    }

    // Validate channel format: must start with #, max 200 chars, safe characters only
    if (
      typeof body.channel !== "string" ||
      !body.channel.startsWith("#") ||
      body.channel.length > 200 ||
      /[\s\x00-\x1f,]/.test(body.channel)
    ) {
      return c.json({ error: "Invalid channel format" }, 400);
    }

    // Validate maxUses is a non-negative integer if provided
    if (body.maxUses !== undefined) {
      if (typeof body.maxUses !== "number" || !Number.isInteger(body.maxUses) || body.maxUses < 0) {
        return c.json({ error: "maxUses must be a non-negative integer" }, 400);
      }
    }

    const user = c.get("user");
    const token = generateToken();
    const expiresInStr = body.expiresIn ?? "7d";
    const durationMs = parseDuration(expiresInStr);
    if (durationMs === null) {
      return c.json({ error: "Invalid expiresIn format (use e.g. 7d, 1h, 30m, or never)" }, 400);
    }
    const expiresAt = durationMs > 0 ? Date.now() + durationMs : 0;
    const maxUses = body.maxUses ?? 0;

    const invite: Invite = {
      token,
      server: env.SERVER_ID,
      channel: body.channel,
      createdBy: user.sub,
      expiresAt,
      maxUses,
      useCount: 0,
    };

    store.add(invite);
    await store.save();

    // Use BASE_URL env var if set (trusted). Falling back to request headers is
    // unsafe (attacker-controlled Host header can craft phishing links), so we
    // only return the token when BASE_URL is not configured.
    const baseUrl = env.BASE_URL;
    let inviteUrl: string;
    if (baseUrl) {
      inviteUrl = `${baseUrl.replace(/\/+$/, '')}/join/${encodeURIComponent(invite.server)}/${token}`;
    } else {
      // No BASE_URL — return token only; client constructs URL from its own origin
      inviteUrl = `/join/${encodeURIComponent(invite.server)}/${token}`;
    }

    return c.json(
      {
        token,
        url: inviteUrl,
        channel: invite.channel,
        expiresAt: invite.expiresAt,
        maxUses: invite.maxUses,
      },
      201,
    );
  });

  // GET /api/invite/:token — validate invite (no auth)
  router.get("/api/invite/:token", async (c) => {
    await ensureLoaded();

    const token = c.req.param("token");
    const invite = store.findByToken(token);

    if (!invite) {
      return c.json({ error: "Invite not found" }, 404);
    }

    if (isExpired(invite)) {
      return c.json({ error: "Invite has expired" }, 410);
    }

    if (isMaxUsesReached(invite)) {
      return c.json({ error: "Invite has reached maximum uses" }, 410);
    }

    // GET is idempotent — just return invite info without consuming a use.
    // Use count is incremented when the client actually joins via POST /api/invite/:token/redeem.
    return c.json({
      channel: invite.channel,
      server: invite.server,
    });
  });

  // POST /api/invite/:token/redeem — consume an invite use (auth required)
  router.post("/api/invite/:token/redeem", authMiddleware, async (c) => {
    await ensureLoaded();

    const token = c.req.param("token");
    const invite = store.findByToken(token);

    if (!invite) {
      return c.json({ error: "Invite not found" }, 404);
    }

    if (isExpired(invite)) {
      return c.json({ error: "Invite has expired" }, 410);
    }

    if (isMaxUsesReached(invite)) {
      return c.json({ error: "Invite has reached maximum uses" }, 410);
    }

    // Safe in single-threaded JS: the check above and the increment below
    // execute synchronously with no await between them, so concurrent
    // requests cannot interleave between the guard and the mutation.
    invite.useCount++;
    await store.save();

    return c.json({
      channel: invite.channel,
      server: invite.server,
    });
  });

  // DELETE /api/invite/:token — revoke invite (auth required, creator only)
  router.delete("/api/invite/:token", authMiddleware, async (c) => {
    await ensureLoaded();

    const token = c.req.param("token");
    const invite = store.findByToken(token);

    if (!invite) {
      return c.json({ error: "Invite not found" }, 404);
    }

    const user = c.get("user");
    if (invite.createdBy !== user.sub) {
      return c.json({ error: "Forbidden" }, 403);
    }

    store.remove(token);
    await store.save();
    return c.json({ ok: true });
  });

  return { router, store };
}
