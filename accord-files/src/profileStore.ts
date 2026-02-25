/**
 * JSON file-based profile storage.
 *
 * Profiles are stored in a single profiles.json file inside DATA_DIR.
 * Uses atomic writes (write to temp file + rename) to prevent corruption.
 */

import { join } from "path";
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, unlinkSync } from "fs";
import { randomUUID } from "crypto";
import { env } from "./env.js";
import type { UserProfile } from "./types.js";

/** In-memory cache of profiles, lazily loaded from disk. */
let profiles: Record<string, UserProfile> | null = null;

/** Allow tests to override the file path. */
let _profilePathOverride: string | null = null;

function profilePath(): string {
  if (_profilePathOverride) return _profilePathOverride;
  return join(env.DATA_DIR, "profiles.json");
}

/** Set a custom path for testing. */
export function setProfilePath(path: string): void {
  _profilePathOverride = path;
  profiles = null; // force reload
}

/** Reset to default path (for test cleanup). */
export function resetProfilePath(): void {
  _profilePathOverride = null;
  profiles = null;
}

/** Ensure the data directory exists. */
function ensureDir(): void {
  const dir = _profilePathOverride
    ? join(_profilePathOverride, "..")
    : env.DATA_DIR;
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/** Load profiles from disk into memory. */
function load(): Record<string, UserProfile> {
  if (profiles !== null) return profiles;

  const path = profilePath();
  try {
    const data = readFileSync(path, "utf-8");
    profiles = JSON.parse(data) as Record<string, UserProfile>;
  } catch {
    profiles = {};
  }
  return profiles;
}

/** Atomically write profiles to disk. */
function save(): void {
  ensureDir();
  const path = profilePath();
  const tmpPath = `${path}.${randomUUID()}.tmp`;

  writeFileSync(tmpPath, JSON.stringify(profiles, null, 2), "utf-8");
  renameSync(tmpPath, path);
}

export function getProfile(account: string): UserProfile | null {
  const data = load();
  return data[account] ?? null;
}

export function setProfile(
  account: string,
  updates: Partial<UserProfile>,
): UserProfile {
  const data = load();
  const existing = data[account];

  const profile: UserProfile = {
    ...existing,
    ...updates,
    account, // ensure account cannot be overwritten by updates
    updatedAt: Date.now(),
  };

  data[account] = profile;
  profiles = data;
  save();

  return profile;
}

export function deleteProfile(account: string): boolean {
  const data = load();
  if (!(account in data)) return false;

  delete data[account];
  profiles = data;
  save();

  return true;
}

export function getAllProfiles(): Record<string, UserProfile> {
  return JSON.parse(JSON.stringify(load()));
}

/** Force reload from disk (useful for tests). */
export function reloadProfiles(): void {
  profiles = null;
}
