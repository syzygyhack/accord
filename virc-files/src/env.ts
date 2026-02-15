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

let _ergoTokenWarned = false;

export const env = {
  get ERGO_API() {
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
} as const;
