import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth.js";
import type { AppEnv } from "../types.js";

const preview = new Hono<AppEnv>();

/** In-memory cache for OG metadata. */
interface CacheEntry {
  data: OgMetadata;
  expiresAt: number;
}

interface OgMetadata {
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
  url: string;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CACHE_MAX_SIZE = 1000;
const FETCH_TIMEOUT_MS = 5000;
const MAX_RESPONSE_BYTES = 1024 * 1024; // 1 MB
const MAX_REDIRECTS = 3;

const cache = new Map<string, CacheEntry>();

/** Evict expired entries; if still over limit, drop oldest. */
function evictCache() {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
  // If still over limit, remove oldest entries
  if (cache.size > CACHE_MAX_SIZE) {
    const excess = cache.size - CACHE_MAX_SIZE;
    const keys = cache.keys();
    for (let i = 0; i < excess; i++) {
      const { value } = keys.next();
      if (value) cache.delete(value);
    }
  }
}

/** RFC-1918 / loopback / link-local checker for SSRF prevention. */
function isPrivateHost(hostname: string): boolean {
  // IPv4 patterns
  if (/^127\./.test(hostname)) return true;
  if (/^10\./.test(hostname)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return true;
  if (/^192\.168\./.test(hostname)) return true;
  if (/^169\.254\./.test(hostname)) return true;
  if (hostname === "0.0.0.0") return true;
  if (hostname === "localhost") return true;

  // IPv6 loopback / link-local
  if (hostname === "::1" || hostname === "[::1]") return true;
  if (/^fe80:/i.test(hostname) || /^\[fe80:/i.test(hostname)) return true;
  if (/^fc00:/i.test(hostname) || /^\[fc00:/i.test(hostname)) return true;
  if (/^fd/i.test(hostname) || /^\[fd/i.test(hostname)) return true;

  return false;
}

/** Validate URL for safety. */
function validateUrl(raw: string): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }

  if (isPrivateHost(parsed.hostname)) {
    return null;
  }

  return parsed;
}

/** Extract OG meta tags from HTML string. */
function parseOgTags(html: string): Omit<OgMetadata, "url"> {
  const get = (property: string): string | null => {
    // Match <meta property="og:..." content="..."> or <meta content="..." property="og:...">
    const pattern = new RegExp(
      `<meta\\s+[^>]*(?:property=["']${property}["'][^>]*content=["']([^"']*)["']|content=["']([^"']*)["'][^>]*property=["']${property}["'])`,
      "i",
    );
    const match = html.match(pattern);
    return match?.[1] ?? match?.[2] ?? null;
  };

  return {
    title: get("og:title"),
    description: get("og:description"),
    image: get("og:image"),
    siteName: get("og:site_name"),
  };
}

/** Fetch URL with timeout, redirect limit, and size cap. */
async function fetchUrl(url: string): Promise<string> {
  let currentUrl = url;

  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const res = await fetch(currentUrl, {
        signal: controller.signal,
        redirect: "manual",
        headers: {
          "User-Agent": "virc-link-preview/1.0",
          Accept: "text/html",
        },
      });

      // Handle redirects manually to enforce limit and check targets
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("Location");
        if (!location) throw new Error("Redirect without Location header");

        const resolved = new URL(location, currentUrl).href;
        const validated = validateUrl(resolved);
        if (!validated) throw new Error("Redirect to disallowed URL");

        currentUrl = resolved;
        continue;
      }

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const contentType = res.headers.get("Content-Type") ?? "";
      if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
        throw new Error("Response is not HTML");
      }

      // Read with size limit
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const chunks: Uint8Array[] = [];
      let totalBytes = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > MAX_RESPONSE_BYTES) {
          reader.cancel();
          break;
        }
        chunks.push(value);
      }

      const decoder = new TextDecoder();
      return chunks.map((c) => decoder.decode(c, { stream: true })).join("") +
        decoder.decode();
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error("Too many redirects");
}

preview.get("/api/preview", authMiddleware, async (c) => {
  const rawUrl = c.req.query("url");
  if (!rawUrl) {
    return c.json({ error: "Missing url parameter" }, 400);
  }

  const parsed = validateUrl(rawUrl);
  if (!parsed) {
    return c.json({ error: "Invalid or disallowed URL" }, 400);
  }

  const cacheKey = parsed.href;

  // Check cache
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return c.json(cached.data);
  }

  try {
    const html = await fetchUrl(parsed.href);
    const og = parseOgTags(html);

    const result: OgMetadata = {
      ...og,
      url: parsed.href,
    };

    // Store in cache
    evictCache();
    cache.set(cacheKey, {
      data: result,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    return c.json(result);
  } catch {
    return c.json({ error: "Failed to fetch URL" }, 502);
  }
});

export { preview, cache, validateUrl, parseOgTags, isPrivateHost };
