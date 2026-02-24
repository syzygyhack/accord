/**
 * Structured security event logging (ACC-15).
 *
 * Emits JSON-formatted log lines to stdout for security-relevant events:
 * auth failures/successes, file uploads, invite operations, account changes.
 *
 * These logs support incident response and audit trails. In production,
 * pipe stdout to a log aggregator (e.g., Loki, Datadog, CloudWatch).
 */

import type { Context } from "hono";

export type SecurityEvent =
  | "auth.success"
  | "auth.failure"
  | "upload"
  | "invite.create"
  | "invite.redeem"
  | "invite.revoke"
  | "account.password_change"
  | "account.email_change"
  | "profile.update"
  | "profile.delete"
  | "profile.avatar"
  | "admin.kick"
  | "admin.ban"
  | "admin.announce"
  | "admin.audit_view";

export interface SecurityLogEntry {
  ts: string;
  event: SecurityEvent;
  account?: string;
  ip?: string;
  detail?: string;
}

/** In-memory ring buffer of recent security log entries for audit queries. */
const LOG_BUFFER_MAX = 1000;
const logBuffer: SecurityLogEntry[] = [];

/** Extract client IP from request context (same logic as rate limiter). */
export function clientIp(c: Context): string {
  const trustProxy = process.env.TRUST_PROXY === "true";
  if (trustProxy) {
    const forwarded = c.req.header("X-Forwarded-For");
    const parts = forwarded?.split(",");
    return parts?.[parts.length - 1]?.trim()
      || c.req.header("X-Real-IP")
      || (c.env?.remoteAddr as string | undefined)
      || "unknown";
  }
  return (c.env?.remoteAddr as string | undefined) || "unknown";
}

export function securityLog(
  event: SecurityEvent,
  fields: Omit<SecurityLogEntry, "ts" | "event">,
): void {
  const entry: SecurityLogEntry = {
    ts: new Date().toISOString(),
    event,
    ...fields,
  };
  // Append to in-memory ring buffer
  logBuffer.push(entry);
  if (logBuffer.length > LOG_BUFFER_MAX) {
    logBuffer.shift();
  }
  console.log(JSON.stringify(entry));
}

/**
 * Query recent security log entries with pagination.
 * Returns entries in reverse chronological order (newest first).
 */
export function getSecurityLogs(
  offset = 0,
  limit = 50,
): { entries: SecurityLogEntry[]; total: number } {
  const total = logBuffer.length;
  // Reverse so newest is first, then paginate
  const reversed = [...logBuffer].reverse();
  const entries = reversed.slice(offset, offset + limit);
  return { entries, total };
}

/** Clear the in-memory log buffer (for testing). */
export function clearSecurityLogs(): void {
  logBuffer.length = 0;
}
