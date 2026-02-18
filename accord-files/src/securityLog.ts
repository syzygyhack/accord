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
  | "account.email_change";

interface SecurityLogEntry {
  ts: string;
  event: SecurityEvent;
  account?: string;
  ip?: string;
  detail?: string;
}

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
  console.log(JSON.stringify(entry));
}
