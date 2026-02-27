import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { setupEnv } from "./helpers.js";

// Set env before any source imports
setupEnv();

// env.ts runs validateOnce() at import time, which is fine since setupEnv() set the required vars.
// We test deriveServerId by manipulating process.env and re-importing via the lazy getter.
import { env } from "../src/env.js";

describe("env.SERVER_ID (deriveServerId)", () => {
  const originalServerId = process.env.SERVER_ID;
  const originalBaseUrl = process.env.BASE_URL;
  const originalServerName = process.env.SERVER_NAME;

  afterEach(() => {
    // Restore original env
    if (originalServerId !== undefined) process.env.SERVER_ID = originalServerId;
    else delete process.env.SERVER_ID;
    if (originalBaseUrl !== undefined) process.env.BASE_URL = originalBaseUrl;
    else delete process.env.BASE_URL;
    if (originalServerName !== undefined) process.env.SERVER_NAME = originalServerName;
    else delete process.env.SERVER_NAME;
  });

  test("returns SERVER_ID when explicitly set", () => {
    process.env.SERVER_ID = "my.custom.server";
    expect(env.SERVER_ID).toBe("my.custom.server");
  });

  test("falls back to BASE_URL host when SERVER_ID is unset", () => {
    delete process.env.SERVER_ID;
    process.env.BASE_URL = "https://chat.example.com:8443/path";
    expect(env.SERVER_ID).toBe("chat.example.com:8443");
  });

  test("falls back to SERVER_NAME when SERVER_ID and BASE_URL are unset", () => {
    delete process.env.SERVER_ID;
    delete process.env.BASE_URL;
    process.env.SERVER_NAME = "my.irc.server";
    expect(env.SERVER_ID).toBe("my.irc.server");
  });

  test("rejects unsafe SERVER_NAME as server ID", () => {
    delete process.env.SERVER_ID;
    delete process.env.BASE_URL;
    // Contains spaces — fails isSafeServerId regex
    process.env.SERVER_NAME = "My Cool Server";
    expect(env.SERVER_ID).toBe("accord.local");
  });

  test("falls back to accord.local when nothing is set", () => {
    delete process.env.SERVER_ID;
    delete process.env.BASE_URL;
    delete process.env.SERVER_NAME;
    expect(env.SERVER_ID).toBe("accord.local");
  });

  test("ignores invalid BASE_URL and falls through", () => {
    delete process.env.SERVER_ID;
    process.env.BASE_URL = "not-a-url";
    process.env.SERVER_NAME = "fallback.server";
    expect(env.SERVER_ID).toBe("fallback.server");
  });

  test("trims whitespace from SERVER_ID", () => {
    process.env.SERVER_ID = "  trimmed.server  ";
    expect(env.SERVER_ID).toBe("trimmed.server");
  });
});

describe("env.MAX_FILE_SIZE (optionalInt)", () => {
  const original = process.env.MAX_FILE_SIZE;

  afterEach(() => {
    if (original !== undefined) process.env.MAX_FILE_SIZE = original;
    else delete process.env.MAX_FILE_SIZE;
  });

  test("returns default when env var is unset", () => {
    delete process.env.MAX_FILE_SIZE;
    expect(env.MAX_FILE_SIZE).toBe(25 * 1024 * 1024);
  });

  test("parses valid integer", () => {
    process.env.MAX_FILE_SIZE = "1048576";
    expect(env.MAX_FILE_SIZE).toBe(1048576);
  });

  test("returns default on non-numeric value", () => {
    process.env.MAX_FILE_SIZE = "not-a-number";
    expect(env.MAX_FILE_SIZE).toBe(25 * 1024 * 1024);
  });

  test("returns default on empty string", () => {
    process.env.MAX_FILE_SIZE = "";
    expect(env.MAX_FILE_SIZE).toBe(25 * 1024 * 1024);
  });
});

describe("env required vars", () => {
  test("JWT_SECRET returns the configured value", () => {
    expect(env.JWT_SECRET).toBe(process.env.JWT_SECRET);
  });

  test("ERGO_API returns configured value", () => {
    expect(env.ERGO_API).toBe(process.env.ERGO_API);
  });
});
