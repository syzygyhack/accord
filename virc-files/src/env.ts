function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

/** Parse an integer env var with validation. Falls back to defaultVal on NaN. */
function optionalInt(name: string, defaultVal: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return defaultVal;
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    console.warn(`WARNING: ${name}="${raw}" is not a valid integer — using default ${defaultVal}`);
    return defaultVal;
  }
  return parsed;
}

const INSECURE_SECRETS = new Set([
  "change-me-to-a-random-string",
  "dev-ergo-api-token",
  "dev-jwt-secret",
  "changeme",
  "secret",
  "password",
]);

let _validated = false;
let _serverIdWarned = false;
let _baseUrlWarned = false;

const SERVER_ID_PATTERN = /^[A-Za-z0-9.-]+(?::\d+)?$/;

function isSafeServerId(value: string): boolean {
  return SERVER_ID_PATTERN.test(value);
}

/** One-time startup warnings for insecure or missing configuration. */
function validateOnce(): void {
  if (_validated) return;
  _validated = true;

  const jwt = process.env.JWT_SECRET;
  if (jwt && INSECURE_SECRETS.has(jwt)) {
    console.warn("WARNING: JWT_SECRET is a known default — generate a secure random value for production");
  }

  if (!process.env.SERVER_NAME) {
    console.warn("WARNING: SERVER_NAME is not set — clients will see a generic server name");
  }

  if (process.env.LIVEKIT_API_KEY === "devkey") {
    console.warn("WARNING: Using default LiveKit dev credentials — change LIVEKIT_API_KEY/SECRET for production");
  }

  const ergoToken = process.env.ERGO_API_TOKEN;
  if (ergoToken && INSECURE_SECRETS.has(ergoToken)) {
    console.warn("WARNING: ERGO_API_TOKEN is a known default — generate a secure random value for production");
  }

  if (!process.env.ALLOWED_ORIGIN) {
    console.warn("WARNING: ALLOWED_ORIGIN is not set — cross-origin requests will be rejected. Set it to your domain for browser access");
  }
}

function deriveServerId(): string {
  const explicit = process.env.SERVER_ID?.trim();
  if (explicit) return explicit;

  const baseUrl = process.env.BASE_URL?.trim();
  if (baseUrl) {
    try {
      return new URL(baseUrl).host;
    } catch {
      if (!_baseUrlWarned) {
        _baseUrlWarned = true;
        console.warn("WARNING: BASE_URL is not a valid URL — cannot derive SERVER_ID from it");
      }
    }
  }

  const name = process.env.SERVER_NAME?.trim();
  if (name && isSafeServerId(name)) return name;

  if (!_serverIdWarned) {
    _serverIdWarned = true;
    console.warn("WARNING: SERVER_ID is not set — using default \"accord.local\" for JWTs/invites. Set SERVER_ID or BASE_URL for a stable server identifier.");
  }

  return "accord.local";
}

// Run validation at import time so warnings appear on startup
validateOnce();

export const env = {
  get ERGO_API() {
    return optional("ERGO_API", "http://ergo:8089");
  },
  get ERGO_API_TOKEN() {
    return required("ERGO_API_TOKEN");
  },
  get JWT_SECRET() {
    return required("JWT_SECRET");
  },
  get LIVEKIT_API_KEY() {
    return required("LIVEKIT_API_KEY");
  },
  get LIVEKIT_API_SECRET() {
    return required("LIVEKIT_API_SECRET");
  },
  /** Client-facing LiveKit WebSocket URL (returned to browsers). */
  get LIVEKIT_CLIENT_URL() {
    return optional("LIVEKIT_CLIENT_URL", "ws://localhost:7880");
  },
  get PORT() {
    return optionalInt("PORT", 8080);
  },
  get CONFIG_PATH() {
    return optional("CONFIG_PATH", "config/accord.json");
  },
  get SERVER_NAME() {
    return optional("SERVER_NAME", "");
  },
  /** Stable server identifier for JWTs/invites. Prefer SERVER_ID, falls back to BASE_URL host or safe SERVER_NAME. */
  get SERVER_ID() {
    return deriveServerId();
  },
  /** Allowed CORS origins (comma-separated in ALLOWED_ORIGIN). */
  get ALLOWED_ORIGINS() {
    const raw = optional("ALLOWED_ORIGIN", "");
    return raw.split(",").map((value) => value.trim()).filter(Boolean);
  },
  /** Base URL for generated invite links (e.g. https://chat.example.com). Falls back to request Origin/Host. */
  get BASE_URL() {
    return optional("BASE_URL", "");
  },
  get UPLOAD_DIR() {
    return optional("UPLOAD_DIR", "./uploads");
  },
  /** Directory for persistent data files (invites, etc.). */
  get DATA_DIR() {
    return optional("DATA_DIR", "./data");
  },
  /** Maximum upload file size in bytes. Default: 25MB. */
  get MAX_FILE_SIZE() {
    return optionalInt("MAX_FILE_SIZE", 25 * 1024 * 1024);
  },
  /** JWT token lifetime in seconds. Default: 3600 (1 hour). */
  get JWT_EXPIRY() {
    return optionalInt("JWT_EXPIRY", 3600);
  },
  /** Rate limit: max auth attempts per window. Default: 10. */
  get RATE_LIMIT_AUTH_MAX() {
    return optionalInt("RATE_LIMIT_AUTH_MAX", 10);
  },
  /** Rate limit: auth window in ms. Default: 900000 (15 min). */
  get RATE_LIMIT_AUTH_WINDOW() {
    return optionalInt("RATE_LIMIT_AUTH_WINDOW", 900000);
  },
  /** Rate limit: max preview requests per window. Default: 30. */
  get RATE_LIMIT_PREVIEW_MAX() {
    return optionalInt("RATE_LIMIT_PREVIEW_MAX", 30);
  },
  /** Rate limit: max upload requests per window. Default: 20. */
  get RATE_LIMIT_UPLOAD_MAX() {
    return optionalInt("RATE_LIMIT_UPLOAD_MAX", 20);
  },
  /** Rate limit: max invite requests per window. Default: 10. */
  get RATE_LIMIT_INVITE_MAX() {
    return optionalInt("RATE_LIMIT_INVITE_MAX", 10);
  },
  /** Rate limit: general window in ms. Default: 60000 (1 min). */
  get RATE_LIMIT_WINDOW() {
    return optionalInt("RATE_LIMIT_WINDOW", 60000);
  },
} as const;
