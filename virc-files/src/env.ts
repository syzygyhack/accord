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

const INSECURE_SECRETS = new Set([
  "change-me-to-a-random-string",
  "dev-jwt-secret",
  "changeme",
  "secret",
  "password",
]);

let _validated = false;
let _ergoTokenWarned = false;

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
}

export const env = {
  get ERGO_API() {
    validateOnce();
    return optional("ERGO_API", "http://ergo:8089");
  },
  get ERGO_API_TOKEN() {
    const token = optional("ERGO_API_TOKEN", "");
    if (!token && !_ergoTokenWarned) {
      _ergoTokenWarned = true;
      console.warn("WARNING: ERGO_API_TOKEN is not set — Ergo API requests will be unauthenticated");
    }
    return token;
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
  get LIVEKIT_URL() {
    return optional("LIVEKIT_URL", "ws://livekit:7880");
  },
  /** Client-facing LiveKit WebSocket URL (returned to browsers). */
  get LIVEKIT_CLIENT_URL() {
    return optional("LIVEKIT_CLIENT_URL", "ws://localhost:7880");
  },
  get PORT() {
    return parseInt(optional("PORT", "8080"), 10);
  },
  get CONFIG_PATH() {
    return optional("CONFIG_PATH", "config/virc.json");
  },
  get SERVER_NAME() {
    return optional("SERVER_NAME", "");
  },
  get ALLOWED_ORIGIN() {
    return optional("ALLOWED_ORIGIN", "");
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
    return parseInt(optional("MAX_FILE_SIZE", String(25 * 1024 * 1024)), 10);
  },
  /** JWT token lifetime in seconds. Default: 3600 (1 hour). */
  get JWT_EXPIRY() {
    return parseInt(optional("JWT_EXPIRY", "3600"), 10);
  },
  /** Rate limit: max auth attempts per window. Default: 10. */
  get RATE_LIMIT_AUTH_MAX() {
    return parseInt(optional("RATE_LIMIT_AUTH_MAX", "10"), 10);
  },
  /** Rate limit: auth window in ms. Default: 900000 (15 min). */
  get RATE_LIMIT_AUTH_WINDOW() {
    return parseInt(optional("RATE_LIMIT_AUTH_WINDOW", "900000"), 10);
  },
  /** Rate limit: max preview requests per window. Default: 30. */
  get RATE_LIMIT_PREVIEW_MAX() {
    return parseInt(optional("RATE_LIMIT_PREVIEW_MAX", "30"), 10);
  },
  /** Rate limit: max upload requests per window. Default: 20. */
  get RATE_LIMIT_UPLOAD_MAX() {
    return parseInt(optional("RATE_LIMIT_UPLOAD_MAX", "20"), 10);
  },
  /** Rate limit: max invite requests per window. Default: 10. */
  get RATE_LIMIT_INVITE_MAX() {
    return parseInt(optional("RATE_LIMIT_INVITE_MAX", "10"), 10);
  },
  /** Rate limit: general window in ms. Default: 60000 (1 min). */
  get RATE_LIMIT_WINDOW() {
    return parseInt(optional("RATE_LIMIT_WINDOW", "60000"), 10);
  },
} as const;
