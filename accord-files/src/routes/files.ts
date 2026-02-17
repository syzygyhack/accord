import { Hono } from "hono";
import { randomUUID } from "crypto";
import { join, extname, resolve } from "path";
import { mkdir, stat } from "fs/promises";
import { authMiddleware } from "../middleware/auth.js";
import type { AppEnv } from "../types.js";
import { env } from "../env.js";

const files = new Hono<AppEnv>();

/** Ensure the upload directory exists. */
async function ensureUploadDir(): Promise<string> {
  const dir = env.UPLOAD_DIR;
  await mkdir(dir, { recursive: true });
  return dir;
}

files.post("/api/upload", authMiddleware, async (c) => {
  const contentType = c.req.header("Content-Type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return c.json({ error: "Content-Type must be multipart/form-data" }, 400);
  }

  // Early rejection: check Content-Length before parsing the full body.
  // If present and oversized, reject immediately. If absent (chunked), we
  // still parse but rely on the post-parse file.size check below.
  const clHeader = c.req.header("Content-Length");
  if (clHeader) {
    const contentLength = parseInt(clHeader, 10);
    if (!Number.isNaN(contentLength) && contentLength > env.MAX_FILE_SIZE * 1.1) {
      return c.json({ error: "File too large" }, 413);
    }
  }

  const body = await c.req.parseBody();
  const file = body["file"];

  if (!file || !(file instanceof File)) {
    return c.json({ error: "Missing file field" }, 400);
  }

  if (file.size > env.MAX_FILE_SIZE) {
    return c.json({ error: "File too large" }, 413);
  }

  const ext = extname(file.name) || "";
  const uuid = randomUUID();
  const storedName = `${uuid}${ext}`;

  const dir = await ensureUploadDir();
  const filePath = join(dir, storedName);

  await Bun.write(filePath, file);

  return c.json({
    url: `/api/files/${storedName}`,
    filename: file.name,
    size: file.size,
    mimetype: file.type || "application/octet-stream",
  });
});

// No authMiddleware: files use UUID filenames as unguessable tokens.
// Auth would break inline media embeds in chat clients. This is intentional.
files.get("/api/files/:filename", async (c) => {
  const filename = c.req.param("filename");

  // Prevent directory traversal: reject suspicious characters and null bytes
  if (
    filename.includes("..") ||
    filename.includes("/") ||
    filename.includes("\\") ||
    filename.includes("\0")
  ) {
    return c.json({ error: "Invalid filename" }, 400);
  }

  const dir = resolve(env.UPLOAD_DIR);
  const filePath = join(dir, filename);

  // Validate resolved path stays within the upload directory
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
  const mimeType = getMimeType(ext) || file.type || "application/octet-stream";

  // Force download for potentially dangerous content types to prevent XSS
  const forceDownload = UNSAFE_EXTENSIONS.has(ext);

  const headers: Record<string, string> = {
    "Content-Type": mimeType,
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
  };

  if (forceDownload) {
    // Sanitize filename for Content-Disposition: escape quotes and backslashes
    const safeName = filename.replace(/[\\"]/g, "_");
    headers["Content-Disposition"] = `attachment; filename="${safeName}"`;
  }

  return new Response(file, { headers });
});

/**
 * Extensions that could execute scripts in the browser.
 * These are served with Content-Disposition: attachment to prevent XSS.
 */
const UNSAFE_EXTENSIONS = new Set([
  ".svg",
  ".html",
  ".htm",
  ".xhtml",
  ".xht",
  ".shtml",
  ".xml",
  ".xsl",
  ".xslt",
  ".js",
  ".mjs",
  ".cjs",
  ".css",
  ".jsp",
  ".asp",
  ".aspx",
  ".php",
  ".cgi",
  ".pl",
  ".py",
  ".rb",
  ".swf",
]);

/** Common extension → MIME type map (module-level constant). */
const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".json": "application/json",
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".zip": "application/zip",
};

/** Map common extensions to MIME types. */
function getMimeType(ext: string): string | null {
  return MIME_TYPES[ext] ?? null;
}

export { files };
