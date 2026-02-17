import { Hono } from "hono";
import { resolve4 as defaultResolve4, resolve6 as defaultResolve6 } from "node:dns/promises";
import { authMiddleware } from "../middleware/auth.js";
import type { AppEnv } from "../types.js";

/** DNS resolver functions — replaceable for testing. */
let dnsResolve4: (hostname: string) => Promise<string[]> = defaultResolve4;
let dnsResolve6: (hostname: string) => Promise<string[]> = defaultResolve6;

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

  // IPv6 loopback and all-zeros (equivalent to 0.0.0.0)
  if (bare === "::1" || bare === "::") return true;

  // IPv6 link-local and private ranges
  const lower = bare.toLowerCase();
  if (lower.startsWith("fe80:")) return true;  // link-local
  if (lower.startsWith("fc00:")) return true;  // unique local
  if (lower.startsWith("fd")) return true;      // unique local
  if (lower.startsWith("100:")) return true;    // discard-only (100::/64)
  if (lower.startsWith("2001:db8:")) return true; // documentation range

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

/**
 * Resolve a hostname via DNS and check that all resolved IPs are public.
 * Blocks DNS rebinding attacks where a public hostname resolves to a private IP.
 * Skips resolution for raw IP addresses (already checked by isPrivateHost).
 */
async function assertPublicResolution(hostname: string): Promise<void> {
  // If hostname is already an IP literal, isPrivateHost already covered it
  if (parseIPv4(hostname) || hostname === "::1" || hostname.startsWith("[")) {
    return;
  }

  // Resolve both A (IPv4) and AAAA (IPv6) records to prevent bypasses
  // via hostnames that only have AAAA records pointing to private IPv6.
  const [v4Result, v6Result] = await Promise.allSettled([
    dnsResolve4(hostname),
    dnsResolve6(hostname),
  ]);

  const v4Addrs = v4Result.status === "fulfilled" ? v4Result.value : [];
  const v6Addrs = v6Result.status === "fulfilled" ? v6Result.value : [];
  const addresses = [...v4Addrs, ...v6Addrs];

  if (addresses.length === 0) {
    throw new Error(`DNS resolution failed for ${hostname}`);
  }

  for (const addr of addresses) {
    const ipv4 = parseIPv4(addr);
    if (ipv4 && isPrivateIPv4(...ipv4)) {
      throw new Error(`Hostname ${hostname} resolves to private IP ${addr}`);
    }
    // IPv6 checks
    if (addr === "::1" || addr === "::") {
      throw new Error(`Hostname ${hostname} resolves to loopback`);
    }
    const lower = addr.toLowerCase();
    if (lower.startsWith("fe80:") || lower.startsWith("fc00:") || lower.startsWith("fd")
        || lower.startsWith("100:") || lower.startsWith("2001:db8:")) {
      throw new Error(`Hostname ${hostname} resolves to private IPv6`);
    }
  }
}

/**
 * Strip HTML tags from OG content values and decode entities to plain text.
 *
 * The output is **plain text**, NOT safe for direct injection into HTML.
 * The client receives this as a JSON string and must render it as text
 * content (textContent / Svelte `{value}`) — never via `{@html}`.
 */
function sanitizeOgValue(raw: string | null): string | null {
  if (raw === null) return null;
  // Strip HTML tags
  let clean = raw.replace(/<[^>]*>/g, "");
  // Decode common HTML entities to plain-text equivalents.
  // Safe because the result is returned as JSON and the client
  // renders it as text content, not raw HTML.
  clean = clean
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
  // Truncate to prevent absurdly long values
  return clean.length > 1000 ? clean.slice(0, 1000) : clean;
}

/** Extract OG meta tags from HTML string. */
function parseOgTags(html: string): Omit<OgMetadata, "url"> {
  const get = (property: string): string | null => {
    // Match <meta property="og:..." content="..."> in either attribute order.
    // Uses separate patterns for double-quoted and single-quoted values to
    // correctly handle content that contains the other quote character.
    const patterns = [
      // property before content, double quotes
      new RegExp(`<meta\\s+[^>]*property\\s*=\\s*["']${property}["'][^>]*content\\s*=\\s*"([^"]*)"`, "i"),
      // property before content, single quotes
      new RegExp(`<meta\\s+[^>]*property\\s*=\\s*["']${property}["'][^>]*content\\s*=\\s*'([^']*)'`, "i"),
      // content before property, double quotes
      new RegExp(`<meta\\s+[^>]*content\\s*=\\s*"([^"]*)"[^>]*property\\s*=\\s*["']${property}["']`, "i"),
      // content before property, single quotes
      new RegExp(`<meta\\s+[^>]*content\\s*=\\s*'([^']*)'[^>]*property\\s*=\\s*["']${property}["']`, "i"),
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match?.[1] != null) return match[1];
    }
    return null;
  };

  return {
    title: sanitizeOgValue(get("og:title")),
    description: sanitizeOgValue(get("og:description")),
    image: get("og:image"), // URL — validated separately, not rendered as HTML
    siteName: sanitizeOgValue(get("og:site_name")),
  };
}

/**
 * Resolve hostname to a public IP and return a URL that fetches via that IP.
 * This prevents TOCTOU DNS rebinding: we resolve once and pin the IP for the
 * actual fetch, while preserving the original Host header for HTTP routing.
 *
 * Returns { fetchUrl, hostHeader } where fetchUrl uses the resolved IP and
 * hostHeader is the original hostname to send as the Host header.
 */
async function resolvePinnedUrl(parsed: URL): Promise<{ fetchUrl: string; hostHeader: string }> {
  const hostname = parsed.hostname;
  // Use parsed.host (hostname:port) for the Host header so non-default
  // ports are preserved. parsed.host omits the port when it matches the
  // protocol default (80/443), which is the correct HTTP behaviour.
  const hostHeader = parsed.host;

  // If already an IP literal, no resolution needed (isPrivateHost already checked)
  if (parseIPv4(hostname) || hostname === "::1" || hostname.startsWith("[")) {
    return { fetchUrl: parsed.href, hostHeader };
  }

  // Resolve and validate all IPs
  await assertPublicResolution(hostname);

  // Resolve and pin the IP we'll actually connect to, preventing rebinding.
  // Try IPv4 first (simpler URL construction), fall back to IPv6.
  const [v4Result, v6Result] = await Promise.allSettled([
    dnsResolve4(hostname),
    dnsResolve6(hostname),
  ]);
  const v4Addrs = v4Result.status === "fulfilled" ? v4Result.value : [];
  const v6Addrs = v6Result.status === "fulfilled" ? v6Result.value : [];

  if (v4Addrs.length > 0) {
    // Pin to the first resolved IPv4 address
    const pinnedUrl = new URL(parsed.href);
    pinnedUrl.hostname = v4Addrs[0];
    return { fetchUrl: pinnedUrl.href, hostHeader };
  }

  if (v6Addrs.length > 0) {
    // Pin to the first resolved IPv6 address (bracket notation for URL)
    const pinnedUrl = new URL(parsed.href);
    pinnedUrl.hostname = `[${v6Addrs[0]}]`;
    return { fetchUrl: pinnedUrl.href, hostHeader };
  }

  // No addresses resolved — assertPublicResolution would have thrown,
  // but guard defensively.
  throw new Error(`No addresses resolved for ${hostname}`);
}

/** Fetch URL with timeout, redirect limit, size cap, and DNS rebinding protection. */
async function fetchUrl(url: string): Promise<string> {
  let currentUrl = url;

  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    // DNS rebinding protection: resolve hostname, validate IPs are public,
    // and pin the resolved IP for the actual fetch to prevent TOCTOU rebinding.
    const currentParsed = new URL(currentUrl);
    const { fetchUrl: pinnedUrl, hostHeader } = await resolvePinnedUrl(currentParsed);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const res = await fetch(pinnedUrl, {
        signal: controller.signal,
        redirect: "manual",
        headers: {
          "User-Agent": "accord-link-preview/1.0",
          Accept: "text/html",
          Host: hostHeader,
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

    // Resolve relative og:image URLs against the page URL so the client
    // receives an absolute URL it can render directly.
    let image = og.image;
    if (image) {
      try {
        image = new URL(image, parsed.href).href;
      } catch {
        image = null; // Malformed URL — drop it
      }
    }

    const result: OgMetadata = {
      ...og,
      image,
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

/** Override the DNS resolvers (for testing). The resolver receives a hostname and returns IPs. */
function setDnsResolver(resolver: (hostname: string) => Promise<string[]>): void {
  dnsResolve4 = resolver;
  dnsResolve6 = resolver;
}

/** Reset the DNS resolvers to the defaults (for testing). */
function resetDnsResolver(): void {
  dnsResolve4 = defaultResolve4;
  dnsResolve6 = defaultResolve6;
}

export { preview, cache, validateUrl, parseOgTags, isPrivateHost, assertPublicResolution, setDnsResolver, resetDnsResolver };
