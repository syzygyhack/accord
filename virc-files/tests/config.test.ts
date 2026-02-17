import { describe, test, expect } from "bun:test";
import { setupEnv, req } from "./helpers.js";

// Set env before any source imports
setupEnv();

import { config } from "../src/routes/config.js";

describe("GET /.well-known/accord.json", () => {
  test("returns 200 with valid JSON", async () => {
    const res = await config.fetch(req("/.well-known/accord.json"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeDefined();
    expect(typeof body).toBe("object");
  });

  test("response has correct Content-Type", async () => {
    const res = await config.fetch(req("/.well-known/accord.json"));
    const ct = res.headers.get("Content-Type");
    expect(ct).toContain("application/json");
  });

  test("response includes version field", async () => {
    const res = await config.fetch(req("/.well-known/accord.json"));
    const body = await res.json() as Record<string, unknown>;
    expect(body.version).toBeDefined();
    expect(typeof body.version).toBe("number");
  });

  test("response includes name field", async () => {
    const res = await config.fetch(req("/.well-known/accord.json"));
    const body = await res.json() as Record<string, unknown>;
    expect(body.name).toBeDefined();
    expect(typeof body.name).toBe("string");
  });

  test("response includes channels", async () => {
    const res = await config.fetch(req("/.well-known/accord.json"));
    const body = await res.json() as { channels?: { categories?: unknown[] } };
    expect(body.channels).toBeDefined();
    expect(body.channels!.categories).toBeArray();
  });

  test("response includes roles", async () => {
    const res = await config.fetch(req("/.well-known/accord.json"));
    const body = await res.json() as Record<string, unknown>;
    expect(body.roles).toBeDefined();
    expect(typeof body.roles).toBe("object");
  });

  test("response includes ETag header", async () => {
    const res = await config.fetch(req("/.well-known/accord.json"));
    const etag = res.headers.get("ETag");
    expect(etag).toBeDefined();
    expect(etag).toMatch(/^"[a-f0-9]+"$/);
  });

  test("response includes Cache-Control header", async () => {
    const res = await config.fetch(req("/.well-known/accord.json"));
    const cc = res.headers.get("Cache-Control");
    expect(cc).toBe("public, max-age=300");
  });

  test("returns 304 for matching If-None-Match", async () => {
    // First request to get the ETag
    const res1 = await config.fetch(req("/.well-known/accord.json"));
    const etag = res1.headers.get("ETag")!;
    expect(etag).toBeDefined();

    // Second request with If-None-Match
    const res2 = await config.fetch(
      req("/.well-known/accord.json", {
        headers: { "If-None-Match": etag },
      }),
    );
    expect(res2.status).toBe(304);
  });

  test("returns 200 for non-matching If-None-Match", async () => {
    const res = await config.fetch(
      req("/.well-known/accord.json", {
        headers: { "If-None-Match": '"bogus"' },
      }),
    );
    expect(res.status).toBe(200);
  });

  test("default config has expected default roles", async () => {
    const res = await config.fetch(req("/.well-known/accord.json"));
    const body = await res.json() as {
      roles: Record<string, { name: string; color: string | null }>;
    };
    expect(body.roles["~"].name).toBe("Owner");
    expect(body.roles["&"].name).toBe("Admin");
    expect(body.roles["@"].name).toBe("Moderator");
    expect(body.roles["%"].name).toBe("Helper");
    expect(body.roles["+"].name).toBe("Member");
  });
});
