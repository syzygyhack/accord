import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { setupEnv } from "./helpers.js";
import { rmSync, mkdirSync, existsSync, readFileSync } from "fs";
import { join } from "path";

const TEST_DATA_DIR = join(import.meta.dir, ".test-profile-data");
const TEST_PROFILE_PATH = join(TEST_DATA_DIR, "profiles.json");

setupEnv();
process.env.DATA_DIR = TEST_DATA_DIR;

import {
  getProfile,
  setProfile,
  deleteProfile,
  getAllProfiles,
  setProfilePath,
  resetProfilePath,
  reloadProfiles,
} from "../src/profileStore.js";

beforeEach(() => {
  // Clean and recreate test directory
  if (existsSync(TEST_DATA_DIR)) {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  }
  mkdirSync(TEST_DATA_DIR, { recursive: true });
  setProfilePath(TEST_PROFILE_PATH);
});

afterAll(() => {
  resetProfilePath();
  if (existsSync(TEST_DATA_DIR)) {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  }
});

describe("ProfileStore", () => {
  describe("getProfile", () => {
    test("returns null for non-existent profile", () => {
      const result = getProfile("nobody");
      expect(result).toBeNull();
    });

    test("returns profile after it is set", () => {
      setProfile("alice", { displayName: "Alice" });
      const result = getProfile("alice");
      expect(result).not.toBeNull();
      expect(result!.account).toBe("alice");
      expect(result!.displayName).toBe("Alice");
    });
  });

  describe("setProfile", () => {
    test("creates a new profile with correct account and updatedAt", () => {
      const before = Date.now();
      const profile = setProfile("bob", { displayName: "Bob", bio: "Hi" });
      const after = Date.now();

      expect(profile.account).toBe("bob");
      expect(profile.displayName).toBe("Bob");
      expect(profile.bio).toBe("Hi");
      expect(profile.updatedAt).toBeGreaterThanOrEqual(before);
      expect(profile.updatedAt).toBeLessThanOrEqual(after);
    });

    test("updates existing profile and preserves unmodified fields", () => {
      setProfile("carol", { displayName: "Carol", bio: "Original" });
      const updated = setProfile("carol", { bio: "Updated" });

      expect(updated.displayName).toBe("Carol");
      expect(updated.bio).toBe("Updated");
      expect(updated.account).toBe("carol");
    });

    test("cannot overwrite account field via updates", () => {
      const profile = setProfile("dave", { account: "hacker" } as any);
      expect(profile.account).toBe("dave");
    });

    test("persists to disk", () => {
      setProfile("eve", { displayName: "Eve" });

      // Read the file directly to verify persistence
      const data = JSON.parse(readFileSync(TEST_PROFILE_PATH, "utf-8"));
      expect(data.eve).toBeDefined();
      expect(data.eve.displayName).toBe("Eve");
    });

    test("updates updatedAt on each set", async () => {
      setProfile("frank", { displayName: "Frank" });
      const first = getProfile("frank")!.updatedAt;

      // Small delay to ensure different timestamp
      await new Promise((r) => setTimeout(r, 5));

      setProfile("frank", { bio: "Updated" });
      const second = getProfile("frank")!.updatedAt;

      expect(second).toBeGreaterThan(first);
    });
  });

  describe("deleteProfile", () => {
    test("returns false for non-existent profile", () => {
      const result = deleteProfile("ghost");
      expect(result).toBe(false);
    });

    test("deletes an existing profile and returns true", () => {
      setProfile("grace", { displayName: "Grace" });
      expect(getProfile("grace")).not.toBeNull();

      const result = deleteProfile("grace");
      expect(result).toBe(true);
      expect(getProfile("grace")).toBeNull();
    });

    test("persists deletion to disk", () => {
      setProfile("henry", { displayName: "Henry" });
      deleteProfile("henry");

      const data = JSON.parse(readFileSync(TEST_PROFILE_PATH, "utf-8"));
      expect(data.henry).toBeUndefined();
    });
  });

  describe("getAllProfiles", () => {
    test("returns empty object when no profiles exist", () => {
      const all = getAllProfiles();
      expect(Object.keys(all).length).toBe(0);
    });

    test("returns all stored profiles", () => {
      setProfile("alice", { displayName: "Alice" });
      setProfile("bob", { displayName: "Bob" });

      const all = getAllProfiles();
      expect(Object.keys(all).length).toBe(2);
      expect(all.alice.displayName).toBe("Alice");
      expect(all.bob.displayName).toBe("Bob");
    });

    test("returns a copy (mutations do not affect store)", () => {
      setProfile("carol", { displayName: "Carol" });
      const all = getAllProfiles();
      all.carol.displayName = "MUTATED";

      const fresh = getProfile("carol");
      expect(fresh!.displayName).toBe("Carol");
    });
  });

  describe("persistence across reloads", () => {
    test("data survives reload from disk", () => {
      setProfile("dave", { displayName: "Dave", status: "online" });

      // Force reload from disk
      reloadProfiles();

      const profile = getProfile("dave");
      expect(profile).not.toBeNull();
      expect(profile!.displayName).toBe("Dave");
      expect(profile!.status).toBe("online");
    });
  });

  describe("concurrent access safety", () => {
    test("handles rapid sequential writes without corruption", () => {
      for (let i = 0; i < 50; i++) {
        setProfile(`user_${i}`, { displayName: `User ${i}` });
      }

      const all = getAllProfiles();
      expect(Object.keys(all).length).toBe(50);

      // Verify each entry
      for (let i = 0; i < 50; i++) {
        expect(all[`user_${i}`].displayName).toBe(`User ${i}`);
      }
    });

    test("handles interleaved writes and deletes", () => {
      setProfile("a", { displayName: "A" });
      setProfile("b", { displayName: "B" });
      deleteProfile("a");
      setProfile("c", { displayName: "C" });
      setProfile("b", { bio: "Updated B" });
      deleteProfile("c");

      const all = getAllProfiles();
      expect(Object.keys(all).length).toBe(1);
      expect(all.b.displayName).toBe("B");
      expect(all.b.bio).toBe("Updated B");
      expect(all.a).toBeUndefined();
      expect(all.c).toBeUndefined();
    });
  });
});
