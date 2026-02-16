import { describe, test, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { setupEnv, createTestJwt, req } from "./helpers.js";
import { rmSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const TEST_UPLOAD_DIR = join(import.meta.dir, ".test-uploads");

// Set env before any source imports
setupEnv();
process.env.UPLOAD_DIR = TEST_UPLOAD_DIR;
process.env.MAX_FILE_SIZE = String(1024); // 1KB limit for tests

import { files } from "../src/routes/files.js";

beforeAll(() => {
  mkdirSync(TEST_UPLOAD_DIR, { recursive: true });
});

afterEach(() => {
  // Clean uploaded files between tests
  if (existsSync(TEST_UPLOAD_DIR)) {
    rmSync(TEST_UPLOAD_DIR, { recursive: true, force: true });
    mkdirSync(TEST_UPLOAD_DIR, { recursive: true });
  }
});

afterAll(() => {
  if (existsSync(TEST_UPLOAD_DIR)) {
    rmSync(TEST_UPLOAD_DIR, { recursive: true, force: true });
  }
});

/** Build a multipart/form-data Request with a file attached. */
function uploadReq(
  filename: string,
  content: string | Uint8Array,
  opts?: { token?: string; mimetype?: string },
): Request {
  const blob = new Blob(
    [content],
    { type: opts?.mimetype ?? "text/plain" },
  );
  const form = new FormData();
  form.append("file", blob, filename);

  const headers: Record<string, string> = {};
  if (opts?.token) {
    headers["Authorization"] = `Bearer ${opts.token}`;
  }

  return req("/api/upload", {
    method: "POST",
    headers,
    body: form,
  });
}

describe("POST /api/upload", () => {
  test("returns 401 without Authorization header", async () => {
    const res = await files.fetch(uploadReq("test.txt", "hello"));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Authorization");
  });

  test("returns 401 with invalid JWT", async () => {
    const res = await files.fetch(
      uploadReq("test.txt", "hello", { token: "invalid.token.here" }),
    );
    expect(res.status).toBe(401);
  });

  test("returns 401 with expired JWT", async () => {
    const expired = await createTestJwt("alice", { expired: true });
    const res = await files.fetch(
      uploadReq("test.txt", "hello", { token: expired }),
    );
    expect(res.status).toBe(401);
  });

  test("uploads a file successfully", async () => {
    const token = await createTestJwt("alice");
    const res = await files.fetch(
      uploadReq("hello.txt", "hello world", {
        token,
        mimetype: "text/plain",
      }),
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      url: string;
      filename: string;
      size: number;
      mimetype: string;
    };
    expect(body.url).toMatch(/^\/api\/files\/[0-9a-f-]+\.txt$/);
    expect(body.filename).toBe("hello.txt");
    expect(body.size).toBe(11); // "hello world".length
    expect(body.mimetype).toContain("text/plain");
  });

  test("returns 413 for oversized file", async () => {
    const token = await createTestJwt("alice");
    // MAX_FILE_SIZE is 1024 bytes for tests
    const largeContent = "x".repeat(2048);
    const res = await files.fetch(
      uploadReq("big.txt", largeContent, { token }),
    );
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("large");
  });

  test("returns 400 when file field is missing", async () => {
    const token = await createTestJwt("alice");
    const form = new FormData();
    form.append("notfile", "some data");

    const res = await files.fetch(
      req("/api/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("file");
  });
});

describe("GET /api/files/:filename", () => {
  test("serves an uploaded file with correct Content-Type", async () => {
    const token = await createTestJwt("alice");

    // Upload first
    const uploadRes = await files.fetch(
      uploadReq("image.png", "fake-png-data", {
        token,
        mimetype: "image/png",
      }),
    );
    expect(uploadRes.status).toBe(200);
    const uploadBody = (await uploadRes.json()) as { url: string };

    // Serve the file
    const serveRes = await files.fetch(req(uploadBody.url));
    expect(serveRes.status).toBe(200);
    expect(serveRes.headers.get("Content-Type")).toBe("image/png");
    expect(serveRes.headers.get("Cache-Control")).toContain("immutable");

    const served = await serveRes.text();
    expect(served).toBe("fake-png-data");
  });

  test("returns 404 for non-existent file", async () => {
    const res = await files.fetch(req("/api/files/does-not-exist.txt"));
    expect(res.status).toBe(404);
  });

  test("returns 400 for directory traversal attempt", async () => {
    const res = await files.fetch(req("/api/files/..%2F..%2Fetc%2Fpasswd"));
    expect(res.status).toBe(400);
  });

  test("serves SVG files with Content-Disposition: attachment", async () => {
    const token = await createTestJwt("alice");
    const svgContent = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';

    const uploadRes = await files.fetch(
      uploadReq("malicious.svg", svgContent, {
        token,
        mimetype: "image/svg+xml",
      }),
    );
    expect(uploadRes.status).toBe(200);
    const uploadBody = (await uploadRes.json()) as { url: string };

    const serveRes = await files.fetch(req(uploadBody.url));
    expect(serveRes.status).toBe(200);
    expect(serveRes.headers.get("Content-Disposition")).toContain("attachment");
    expect(serveRes.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  test("serves HTML files with Content-Disposition: attachment", async () => {
    const token = await createTestJwt("alice");
    const htmlContent = '<html><script>alert(1)</script></html>';

    const uploadRes = await files.fetch(
      uploadReq("page.html", htmlContent, {
        token,
        mimetype: "text/html",
      }),
    );
    expect(uploadRes.status).toBe(200);
    const uploadBody = (await uploadRes.json()) as { url: string };

    const serveRes = await files.fetch(req(uploadBody.url));
    expect(serveRes.status).toBe(200);
    expect(serveRes.headers.get("Content-Disposition")).toContain("attachment");
  });

  test("serves safe files without Content-Disposition: attachment", async () => {
    const token = await createTestJwt("alice");

    const uploadRes = await files.fetch(
      uploadReq("photo.png", "fake-png", {
        token,
        mimetype: "image/png",
      }),
    );
    expect(uploadRes.status).toBe(200);
    const uploadBody = (await uploadRes.json()) as { url: string };

    const serveRes = await files.fetch(req(uploadBody.url));
    expect(serveRes.status).toBe(200);
    expect(serveRes.headers.get("Content-Disposition")).toBeNull();
  });

  // --- CR-048: Additional dangerous extension tests ---

  test("serves .xml files with Content-Disposition: attachment", async () => {
    const token = await createTestJwt("alice");
    const xmlContent = '<?xml version="1.0"?><root><script>alert(1)</script></root>';

    const uploadRes = await files.fetch(
      uploadReq("data.xml", xmlContent, { token, mimetype: "application/xml" }),
    );
    expect(uploadRes.status).toBe(200);
    const uploadBody = (await uploadRes.json()) as { url: string };

    const serveRes = await files.fetch(req(uploadBody.url));
    expect(serveRes.status).toBe(200);
    expect(serveRes.headers.get("Content-Disposition")).toContain("attachment");
    expect(serveRes.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  test("serves .js files with Content-Disposition: attachment", async () => {
    const token = await createTestJwt("alice");

    const uploadRes = await files.fetch(
      uploadReq("payload.js", "alert(document.cookie)", { token, mimetype: "application/javascript" }),
    );
    expect(uploadRes.status).toBe(200);
    const uploadBody = (await uploadRes.json()) as { url: string };

    const serveRes = await files.fetch(req(uploadBody.url));
    expect(serveRes.status).toBe(200);
    expect(serveRes.headers.get("Content-Disposition")).toContain("attachment");
  });

  test("serves .xhtml files with Content-Disposition: attachment", async () => {
    const token = await createTestJwt("alice");

    const uploadRes = await files.fetch(
      uploadReq("page.xhtml", "<html><script>alert(1)</script></html>", { token, mimetype: "application/xhtml+xml" }),
    );
    expect(uploadRes.status).toBe(200);
    const uploadBody = (await uploadRes.json()) as { url: string };

    const serveRes = await files.fetch(req(uploadBody.url));
    expect(serveRes.status).toBe(200);
    expect(serveRes.headers.get("Content-Disposition")).toContain("attachment");
  });

  test("serves .css files with Content-Disposition: attachment", async () => {
    const token = await createTestJwt("alice");

    const uploadRes = await files.fetch(
      uploadReq("style.css", "body { background: url(javascript:alert(1)) }", { token, mimetype: "text/css" }),
    );
    expect(uploadRes.status).toBe(200);
    const uploadBody = (await uploadRes.json()) as { url: string };

    const serveRes = await files.fetch(req(uploadBody.url));
    expect(serveRes.status).toBe(200);
    expect(serveRes.headers.get("Content-Disposition")).toContain("attachment");
  });
});
