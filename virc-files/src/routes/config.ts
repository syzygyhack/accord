import { Hono } from "hono";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const config = new Hono();

const DEFAULT_CONFIG = {
  $schema: "https://virc.app/schema/server-config-v1.json",
  version: 1,
  name: "virc",
  description: "A virc community server",

  roles: {
    "~": { name: "Owner", color: "#e0a040" },
    "&": { name: "Admin", color: "#e05050" },
    "@": { name: "Moderator", color: "#50a0e0" },
    "%": { name: "Helper", color: "#50e0a0" },
    "+": { name: "Member", color: null },
  },

  channels: {
    categories: [
      {
        name: "Text Channels",
        channels: ["#general"],
      },
      {
        name: "Voice Channels",
        channels: ["#voice-lobby"],
        voice: true,
      },
    ],
  },
};

let cachedConfig: object | null = null;

async function loadConfig(): Promise<object> {
  if (cachedConfig) return cachedConfig;

  const configPath = resolve("config/virc.json");
  try {
    const raw = await readFile(configPath, "utf-8");
    cachedConfig = JSON.parse(raw);
    return cachedConfig!;
  } catch {
    // File doesn't exist or isn't valid JSON — use defaults
    return DEFAULT_CONFIG;
  }
}

config.get("/.well-known/virc.json", async (c) => {
  const cfg = await loadConfig();
  return c.json(cfg);
});

export { config };
