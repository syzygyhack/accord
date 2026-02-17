import { describe, test, expect, beforeEach, mock } from "bun:test";
import { setupEnv, createTestJwt, req } from "./helpers.js";

setupEnv();

import { preview, cache, validateUrl, parseOgTags, isPrivateHost, assertPublicResolution, setDnsResolver, resetDnsResolver } from "../src/routes/preview.js";

const OG_HTML = `<!doctype html>
<html>
<head>
  <meta property="og:title" content="Test Page">
  <meta property="og:description" content="A test description">
  <meta property="og:image" content="https://example.com/image.png">
  <meta property="og:site_name" content="Example">
</head>
<body></body>
</html>`;

/** Helper to build an authenticated GET request. */
async function previewReq(
  url: string,
  opts?: { token?: string },
): Promise<Request> {
  const headers: Record<string, string> = {};
  if (opts?.token) {
    headers["Authorization"] = `Bearer ${opts.token}`;
  }
  const encoded = encodeURIComponent(url);
  return req(`/api/preview?url=${encoded}`, { headers });
}

beforeEach(() => {
  cache.clear();
});

// --- Unit tests for helpers ---

describe("validateUrl", () => {
  test("accepts http URL", () => {
    expect(validateUrl("http://example.com")).not.toBeNull();
  });

  test("accepts https URL", () => {
    expect(validateUrl("https://example.com/page")).not.toBeNull();
  });

  test("rejects ftp scheme", () => {
    expect(validateUrl("ftp://example.com")).toBeNull();
  });

  test("rejects javascript scheme", () => {
    expect(validateUrl("javascript:alert(1)")).toBeNull();
  });

  test("rejects file scheme", () => {
    expect(validateUrl("file:///etc/passwd")).toBeNull();
  });

  test("rejects invalid URL", () => {
    expect(validateUrl("not a url")).toBeNull();
  });
});

describe("isPrivateHost", () => {
  test("rejects localhost", () => {
    expect(isPrivateHost("localhost")).toBe(true);
  });

  test("rejects 127.0.0.1", () => {
    expect(isPrivateHost("127.0.0.1")).toBe(true);
  });

  test("rejects 10.x.x.x", () => {
    expect(isPrivateHost("10.0.0.1")).toBe(true);
  });

  test("rejects 192.168.x.x", () => {
    expect(isPrivateHost("192.168.1.1")).toBe(true);
  });

  test("rejects 172.16-31.x.x", () => {
    expect(isPrivateHost("172.16.0.1")).toBe(true);
    expect(isPrivateHost("172.31.255.255")).toBe(true);
  });

  test("accepts public IP", () => {
    expect(isPrivateHost("8.8.8.8")).toBe(false);
  });

  test("accepts public domain", () => {
    expect(isPrivateHost("example.com")).toBe(false);
  });

  test("rejects 0.0.0.0", () => {
    expect(isPrivateHost("0.0.0.0")).toBe(true);
  });

  test("rejects link-local 169.254.x.x", () => {
    expect(isPrivateHost("169.254.1.1")).toBe(true);
  });

  test("rejects IPv6 loopback", () => {
    expect(isPrivateHost("::1")).toBe(true);
    expect(isPrivateHost("[::1]")).toBe(true);
  });

  test("rejects octal IP 0177.0.0.1 (127.0.0.1)", () => {
    expect(isPrivateHost("0177.0.0.1")).toBe(true);
  });

  test("rejects hex IP 0x7f000001 (127.0.0.1)", () => {
    expect(isPrivateHost("0x7f000001")).toBe(true);
  });

  test("rejects decimal integer 2130706433 (127.0.0.1)", () => {
    expect(isPrivateHost("2130706433")).toBe(true);
  });

  test("rejects IPv6-mapped IPv4 ::ffff:127.0.0.1", () => {
    expect(isPrivateHost("::ffff:127.0.0.1")).toBe(true);
  });

  test("rejects IPv6-mapped hex ::ffff:7f00:1", () => {
    expect(isPrivateHost("::ffff:7f00:1")).toBe(true);
  });

  test("rejects IPv6 link-local fe80::", () => {
    expect(isPrivateHost("fe80::1")).toBe(true);
  });

  test("rejects IPv6 unique-local fd00::", () => {
    expect(isPrivateHost("fd12::1")).toBe(true);
  });

  // --- Bracketed IPv6 variants (CR-046) ---

  test("rejects bracketed IPv6 link-local [fe80::1]", () => {
    expect(isPrivateHost("[fe80::1]")).toBe(true);
  });

  test("rejects bracketed IPv6-mapped IPv4 [::ffff:127.0.0.1]", () => {
    expect(isPrivateHost("[::ffff:127.0.0.1]")).toBe(true);
  });

  test("rejects bracketed IPv6 unique-local [fd12::1]", () => {
    expect(isPrivateHost("[fd12::1]")).toBe(true);
  });

  // --- IPv6-mapped private ranges beyond loopback ---

  test("rejects IPv6-mapped 10.x.x.x ::ffff:10.0.0.1", () => {
    expect(isPrivateHost("::ffff:10.0.0.1")).toBe(true);
  });

  test("rejects IPv6-mapped 192.168.x.x ::ffff:192.168.1.1", () => {
    expect(isPrivateHost("::ffff:192.168.1.1")).toBe(true);
  });

  test("rejects IPv6-mapped hex for 10.0.0.1 ::ffff:0a00:1", () => {
    expect(isPrivateHost("::ffff:0a00:1")).toBe(true);
  });

  // --- Mixed dotted notation edge cases ---

  test("rejects hex-dotted 0x0a.0.0.1 (10.0.0.1)", () => {
    expect(isPrivateHost("0x0a.0.0.1")).toBe(true);
  });

  test("rejects mixed hex-octal 0x7f.0.0.01 (127.0.0.1)", () => {
    expect(isPrivateHost("0x7f.0.0.01")).toBe(true);
  });

  test("accepts public hex IP 0x08080808 (8.8.8.8)", () => {
    expect(isPrivateHost("0x08080808")).toBe(false);
  });

  test("rejects bracketed documentation-range IPv6 (2001:db8::/32)", () => {
    expect(isPrivateHost("[2001:db8::1]")).toBe(true);
  });

  test("accepts bracketed public IPv6", () => {
    expect(isPrivateHost("[2607:f8b0:4004::1]")).toBe(false);
  });
});

describe("assertPublicResolution", () => {
  test("rejects hostname resolving to private IP", async () => {
    setDnsResolver(async () => ["127.0.0.1"]);
    try {
      await expect(assertPublicResolution("evil.example.com")).rejects.toThrow("private IP");
    } finally {
      resetDnsResolver();
    }
  });

  test("rejects hostname resolving to 10.x.x.x", async () => {
    setDnsResolver(async () => ["10.0.0.1"]);
    try {
      await expect(assertPublicResolution("evil.example.com")).rejects.toThrow("private IP");
    } finally {
      resetDnsResolver();
    }
  });

  test("rejects hostname resolving to 192.168.x.x", async () => {
    setDnsResolver(async () => ["192.168.1.100"]);
    try {
      await expect(assertPublicResolution("evil.example.com")).rejects.toThrow("private IP");
    } finally {
      resetDnsResolver();
    }
  });

  test("allows hostname resolving to public IP", async () => {
    setDnsResolver(async () => ["93.184.216.34"]);
    try {
      await expect(assertPublicResolution("example.com")).resolves.toBeUndefined();
    } finally {
      resetDnsResolver();
    }
  });

  test("skips DNS for raw IPv4 addresses", async () => {
    // Raw IP should not trigger DNS resolution — already checked by isPrivateHost
    await expect(assertPublicResolution("8.8.8.8")).resolves.toBeUndefined();
  });

  test("rejects when DNS resolution fails", async () => {
    setDnsResolver(async () => { throw new Error("NXDOMAIN"); });
    try {
      await expect(assertPublicResolution("nonexistent.invalid")).rejects.toThrow("DNS resolution failed");
    } finally {
      resetDnsResolver();
    }
  });
});

describe("parseOgTags", () => {
  test("extracts all OG tags from HTML", () => {
    const result = parseOgTags(OG_HTML);
    expect(result.title).toBe("Test Page");
    expect(result.description).toBe("A test description");
    expect(result.image).toBe("https://example.com/image.png");
    expect(result.siteName).toBe("Example");
  });

  test("returns null for missing tags", () => {
    const html = "<html><head></head><body></body></html>";
    const result = parseOgTags(html);
    expect(result.title).toBeNull();
    expect(result.description).toBeNull();
    expect(result.image).toBeNull();
    expect(result.siteName).toBeNull();
  });

  test("handles reversed attribute order", () => {
    const html = `<meta content="Reversed" property="og:title">`;
    const result = parseOgTags(html);
    expect(result.title).toBe("Reversed");
  });
});

// --- Integration tests for the endpoint ---

describe("GET /api/preview", () => {
  test("returns 401 without Authorization header", async () => {
    const r = await previewReq("https://example.com");
    const res = await preview.fetch(r);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Authorization");
  });

  test("returns 401 with expired JWT", async () => {
    const token = await createTestJwt("alice", { expired: true });
    const r = await previewReq("https://example.com", { token });
    const res = await preview.fetch(r);
    expect(res.status).toBe(401);
  });

  test("returns 400 when url parameter is missing", async () => {
    const token = await createTestJwt("alice");
    const r = req("/api/preview", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const res = await preview.fetch(r);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("url");
  });

  test("returns 400 for non-http scheme", async () => {
    const token = await createTestJwt("alice");
    const r = await previewReq("ftp://example.com", { token });
    const res = await preview.fetch(r);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Invalid");
  });

  test("returns 400 for private IP (SSRF)", async () => {
    const token = await createTestJwt("alice");
    const r = await previewReq("http://192.168.1.1/admin", { token });
    const res = await preview.fetch(r);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Invalid");
  });

  test("returns 400 for localhost (SSRF)", async () => {
    const token = await createTestJwt("alice");
    const r = await previewReq("http://localhost:3000/secret", { token });
    const res = await preview.fetch(r);
    expect(res.status).toBe(400);
  });

  test("returns OG metadata on success", async () => {
    const originalFetch = globalThis.fetch;
    setDnsResolver(async () => ["93.184.216.34"]);
    globalThis.fetch = mock(async () =>
      new Response(OG_HTML, {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );

    try {
      const token = await createTestJwt("alice");
      const r = await previewReq("https://example.com/page", { token });
      const res = await preview.fetch(r);
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        title: string;
        description: string;
        image: string;
        siteName: string;
        url: string;
      };
      expect(body.title).toBe("Test Page");
      expect(body.description).toBe("A test description");
      expect(body.image).toBe("https://example.com/image.png");
      expect(body.siteName).toBe("Example");
      expect(body.url).toBe("https://example.com/page");
    } finally {
      globalThis.fetch = originalFetch;
      resetDnsResolver();
    }
  });

  test("caches results and returns cached data", async () => {
    let fetchCount = 0;
    const originalFetch = globalThis.fetch;
    setDnsResolver(async () => ["93.184.216.34"]);
    globalThis.fetch = mock(async () => {
      fetchCount++;
      return new Response(OG_HTML, {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });
    });

    try {
      const token = await createTestJwt("alice");

      // First request – fetches
      const r1 = await previewReq("https://example.com/cached", { token });
      const res1 = await preview.fetch(r1);
      expect(res1.status).toBe(200);
      expect(fetchCount).toBe(1);

      // Second request – should hit cache
      const r2 = await previewReq("https://example.com/cached", { token });
      const res2 = await preview.fetch(r2);
      expect(res2.status).toBe(200);
      expect(fetchCount).toBe(1); // No additional fetch
    } finally {
      globalThis.fetch = originalFetch;
      resetDnsResolver();
    }
  });

  test("returns 502 when upstream fetch fails", async () => {
    const originalFetch = globalThis.fetch;
    setDnsResolver(async () => ["93.184.216.34"]);
    globalThis.fetch = mock(async () => {
      throw new Error("Network error");
    });

    try {
      const token = await createTestJwt("alice");
      const r = await previewReq("https://example.com/down", { token });
      const res = await preview.fetch(r);
      expect(res.status).toBe(502);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain("fetch");
    } finally {
      globalThis.fetch = originalFetch;
      resetDnsResolver();
    }
  });

  test("returns 502 for non-HTML response", async () => {
    const originalFetch = globalThis.fetch;
    setDnsResolver(async () => ["93.184.216.34"]);
    globalThis.fetch = mock(async () =>
      new Response('{"data": true}', {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    try {
      const token = await createTestJwt("alice");
      const r = await previewReq("https://example.com/api", { token });
      const res = await preview.fetch(r);
      expect(res.status).toBe(502);
    } finally {
      globalThis.fetch = originalFetch;
      resetDnsResolver();
    }
  });

  test("returns 502 when hostname resolves to private IP (DNS rebinding)", async () => {
    const originalFetch = globalThis.fetch;
    setDnsResolver(async () => ["127.0.0.1"]);
    globalThis.fetch = mock(async () =>
      new Response(OG_HTML, {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );

    try {
      const token = await createTestJwt("alice");
      const r = await previewReq("https://rebind.example.com/page", { token });
      const res = await preview.fetch(r);
      expect(res.status).toBe(502);
    } finally {
      globalThis.fetch = originalFetch;
      resetDnsResolver();
    }
  });
});
