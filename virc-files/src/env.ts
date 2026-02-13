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

export const env = {
  get ERGO_API() {
    return optional("ERGO_API", "http://ergo:8089");
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
} as const;
