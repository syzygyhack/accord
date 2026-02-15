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

/**
 * Check if an IPv4 address (as four octets) is in a private/reserved range.
 */
function isPrivateIPv4(a: number, b: number, c: number, d: number): boolean {
  if (a === 127) return true;              // 127.0.0.0/8 loopback
  if (a === 10) return true;               // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true;  // 192.168.0.0/16
  if (a === 169 && b === 254) return true;  // 169.254.0.0/16 link-local
  if (a === 0) return true;                 // 0.0.0.0/8
  return false;
}

/**
 * Parse a hostname into an IPv4 tuple [a, b, c, d] if possible.
 * Handles dotted-decimal, octal, hex, and decimal integer formats.
 * Returns null if the hostname is not an IPv4 address.
 */
function parseIPv4(hostname: string): [number, number, number, number] | null {
  // Standard dotted format (also handles octal 0177.0.0.1 and hex 0x7f.0.0.1)
  const parts = hostname.split(".");
  if (parts.length === 4) {
    const octets = parts.map((p) => {
      if (/^0x[0-9a-fA-F]+$/.test(p)) return parseInt(p, 16);
      if (/^0[0-7]+$/.test(p) && p.length > 1) return parseInt(p, 8);
      if (/^\d+$/.test(p)) return parseInt(p, 10);
      return NaN;
    });
    if (octets.every((o) => !isNaN(o) && o >= 0 && o <= 255)) {
      return octets as [number, number, number, number];
    }
  }

  // Single decimal integer (e.g. 2130706433 = 127.0.0.1)
  if (/^\d+$/.test(hostname)) {
    const n = parseInt(hostname, 10);
    if (n >= 0 && n <= 0xFFFFFFFF) {
      return [(n >>> 24) & 0xFF, (n >>> 16) & 0xFF, (n >>> 8) & 0xFF, n & 0xFF];
    }
  }

  // Single hex integer (e.g. 0x7f000001)
  if (/^0x[0-9a-fA-F]+$/.test(hostname)) {
    const n = parseInt(hostname, 16);
    if (n >= 0 && n <= 0xFFFFFFFF) {
      return [(n >>> 24) & 0xFF, (n >>> 16) & 0xFF, (n >>> 8) & 0xFF, n & 0xFF];
    }
  }

  return null;
}

/** RFC-1918 / loopback / link-local checker for SSRF prevention. */
function isPrivateHost(hostname: string): boolean {
  // Unwrap IPv6 bracket notation
  const bare = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;

  if (bare === "localhost") return true;

  // Check IPv4 (including octal/hex/integer representations)
  const ipv4 = parseIPv4(bare);
  if (ipv4) return isPrivateIPv4(...ipv4);

  // IPv6 loopback
  if (bare === "::1") return true;

  // IPv6 link-local and private ranges
  const lower = bare.toLowerCase();
  if (lower.startsWith("fe80:")) return true;  // link-local
  if (lower.startsWith("fc00:")) return true;  // unique local
  if (lower.startsWith("fd")) return true;      // unique local

  // IPv6-mapped IPv4: ::ffff:a.b.c.d or ::ffff:XXYY:ZZWW
  const mappedMatch = lower.match(/^::ffff:(.+)$/);
  if (mappedMatch) {
    const mapped = mappedMatch[1];
    const mappedIpv4 = parseIPv4(mapped);
    if (mappedIpv4) return isPrivateIPv4(...mappedIpv4);

    // ::ffff:7f00:1 format (two hex groups representing IPv4)
    const hexParts = mapped.split(":");
    if (hexParts.length === 2) {
      const hi = parseInt(hexParts[0], 16);
      const lo = parseInt(hexParts[1], 16);
      if (!isNaN(hi) && !isNaN(lo)) {
        return isPrivateIPv4((hi >>> 8) & 0xFF, hi & 0xFF, (lo >>> 8) & 0xFF, lo & 0xFF);
      }
    }
  }

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
