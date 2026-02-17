import type { Context, Next } from "hono";

interface RateLimitEntry {
  timestamps: number[];
}

interface RateLimitOptions {
  /** Maximum requests allowed in the window. */
  max: number;
  /** Window duration in milliseconds. */
  windowMs: number;
  /**
   * Maximum number of unique IPs tracked in the store.
   * When exceeded, oldest entries are evicted. Prevents memory exhaustion
   * from attackers rotating IPs. Default: 50_000.
   */
  maxStoreSize?: number;
}

/**
 * In-memory sliding-window rate limiter.
 *
 * IP extraction strategy:
 * When TRUST_PROXY is set to "true", uses the rightmost X-Forwarded-For entry
 * (appended by the trusted reverse proxy). Otherwise, uses only the direct
 * socket address to prevent spoofing. Falls back to "unknown" when no
 * address is available.
 *
 * Store size is capped (default 50,000 entries) to prevent memory exhaustion
 * from IP rotation attacks. When full, oldest entries are evicted.
 */
export function rateLimit(opts: RateLimitOptions) {
  const store = new Map<string, RateLimitEntry>();
  const maxStoreSize = opts.maxStoreSize ?? 50_000;

  // Periodic cleanup every 60s to prevent memory leaks from stale entries
  const CLEANUP_INTERVAL_MS = 60_000;
  let lastCleanup = Date.now();

  // Check env once at construction time (not per-request)
  const trustProxy = process.env.TRUST_PROXY === "true";

  function cleanup(now: number) {
    for (const [key, entry] of store) {
      entry.timestamps = entry.timestamps.filter((t) => now - t < opts.windowMs);
      if (entry.timestamps.length === 0) store.delete(key);
    }
    lastCleanup = now;
  }

  /** Evict oldest entries when store exceeds max size. */
  function evictOldest() {
    if (store.size <= maxStoreSize) return;
    const excess = store.size - maxStoreSize;
    const keys = store.keys();
    for (let i = 0; i < excess; i++) {
      const { value } = keys.next();
      if (value) store.delete(value);
    }
  }

  return async (c: Context, next: Next) => {
    let ip: string;

    if (trustProxy) {
      // Trusted proxy mode: use rightmost X-Forwarded-For entry
      // (set by trusted reverse proxy; leftmost entries are client-controlled)
      const forwarded = c.req.header("X-Forwarded-For");
      const parts = forwarded?.split(",");
      ip = parts?.[parts.length - 1]?.trim()
        || c.req.header("X-Real-IP")
        || (c.env?.remoteAddr as string | undefined)
        || "unknown";
    } else {
      // Direct mode: ignore X-Forwarded-For entirely (attacker-controlled)
      ip = (c.env?.remoteAddr as string | undefined) || "unknown";
    }

    const now = Date.now();

    // Periodic cleanup
    if (now - lastCleanup > CLEANUP_INTERVAL_MS) {
      cleanup(now);
    }

    let entry = store.get(ip);
    if (!entry) {
      entry = { timestamps: [] };
      store.set(ip, entry);
      // Clean up stale entries before evicting valid ones
      if (store.size > maxStoreSize) {
        cleanup(now);
        lastCleanup = now;
      }
      evictOldest();
    }

    // Remove timestamps outside the window
    entry.timestamps = entry.timestamps.filter((t) => now - t < opts.windowMs);

    if (entry.timestamps.length >= opts.max) {
      const retryAfter = Math.ceil(
        (entry.timestamps[0] + opts.windowMs - now) / 1000,
      );
      c.header("Retry-After", String(retryAfter));
      return c.json({ error: "Too many requests" }, 429);
    }

    entry.timestamps.push(now);
    await next();
  };
}
