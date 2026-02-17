import { Hono } from "hono";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { env } from "../env.js";

const config = new Hono();

const DEFAULT_ROLES = {
  "~": { name: "Owner", color: "#e0a040" },
  "&": { name: "Admin", color: "#e05050" },
  "@": { name: "Moderator", color: "#50a0e0" },
  "%": { name: "Helper", color: "#50e0a0" },
  "+": { name: "Member", color: null },
};

// --- Cache state ---

interface ConfigCache {
  config: object;
  etag: string;
  loadedAt: number;
  source: "file" | "generated";
}

let cache: ConfigCache | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function computeEtag(data: string): string {
  const hash = createHash("md5").update(data).digest("hex");
  return `"${hash}"`;
}

function isCacheValid(): boolean {
  if (!cache) return false;
  return Date.now() - cache.loadedAt < CACHE_TTL_MS;
}

// --- Ergo API helpers ---

async function fetchServerName(): Promise<string> {
  // If operator set SERVER_NAME, use it directly
  if (env.SERVER_NAME) return env.SERVER_NAME;

  // Try Ergo /v1/status — it doesn't return server name, but we try anyway
  // in case future versions add it. Fall back to default.
  try {
    const res = await fetch(`${env.ERGO_API}/v1/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const body = (await res.json()) as {
        success?: boolean;
        server_name?: string;
      };
      if (body.server_name) return body.server_name;
    }
  } catch {
    // Ergo unavailable or endpoint doesn't exist — not fatal
  }

  return "accord Server";
}

function buildDefaultConfig(serverName: string): object {
  return {
    $schema: "https://accord.chat/schema/server-config-v1.json",
    version: 1,
    name: serverName,
    description: "An accord community server",

    roles: DEFAULT_ROLES,

    channels: {
      categories: [
        {
          name: "Text Channels",
          channels: ["#general", "#events", "#links"],
        },
        {
          name: "Voice Channels",
          channels: ["#voice-lobby"],
          voice: true,
        },
      ],
    },
  };
}

// --- Config loading ---

async function loadConfig(): Promise<ConfigCache> {
  if (isCacheValid()) return cache!;

  const configPath = resolve(env.CONFIG_PATH);

  // Try loading custom accord.json
  try {
    await stat(configPath); // check existence before reading
    const raw = await readFile(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    const etag = computeEtag(raw);
    cache = { config: parsed, etag, loadedAt: Date.now(), source: "file" };
    return cache;
  } catch {
    // File doesn't exist or isn't valid JSON — generate default
  }

  const serverName = await fetchServerName();
  const generated = buildDefaultConfig(serverName);
  const json = JSON.stringify(generated);
  const etag = computeEtag(json);
  cache = { config: generated, etag, loadedAt: Date.now(), source: "generated" };
  return cache;
}

// --- Route ---

config.get("/.well-known/accord.json", async (c) => {
  const { config: cfg, etag } = await loadConfig();

  // Conditional request support
  const ifNoneMatch = c.req.header("If-None-Match");
  if (ifNoneMatch && ifNoneMatch === etag) {
    return c.body(null, 304);
  }

  c.header("ETag", etag);
  c.header("Cache-Control", "public, max-age=300");
  return c.json(cfg);
});

export { config };
