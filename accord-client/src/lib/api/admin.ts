/**
 * Client-side API for the admin panel.
 *
 * Endpoints (all require admin JWT):
 *   GET  /api/admin/check  - verify current user is admin
 *   GET  /api/admin/stats  - server statistics
 *   GET  /api/admin/users  - list registered users
 *   POST /api/admin/kick   - kick user from channel
 *   POST /api/admin/ban    - ban user from channel
 *   GET  /api/admin/audit  - security audit log
 */

import { normalizeBaseUrl } from '$lib/utils/url';

export interface AdminStats {
	registeredAccounts: number;
	profileCount: number;
	channels: number;
	uptimeMs: number;
	uptimeSeconds: number;
}

export interface AdminUser {
	account: string;
	displayName: string | null;
	status: string | null;
	updatedAt: number;
}

export interface AuditEntry {
	action: string;
	account: string;
	ip: string;
	detail: string;
	timestamp: number;
}

export interface AuditResponse {
	entries: AuditEntry[];
	total: number;
	offset: number;
	limit: number;
}

/** Check whether the current user has admin privileges. */
export async function checkAdmin(filesUrl: string, authToken: string): Promise<boolean> {
	const baseUrl = normalizeBaseUrl(filesUrl);
	try {
		const res = await fetch(`${baseUrl}/api/admin/check`, {
			headers: { Authorization: `Bearer ${authToken}` },
		});
		return res.ok;
	} catch {
		return false;
	}
}

/** Fetch server statistics. Returns null on failure. */
export async function fetchStats(filesUrl: string, authToken: string): Promise<AdminStats | null> {
	const baseUrl = normalizeBaseUrl(filesUrl);
	try {
		const res = await fetch(`${baseUrl}/api/admin/stats`, {
			headers: { Authorization: `Bearer ${authToken}` },
		});
		if (!res.ok) return null;
		return (await res.json()) as AdminStats;
	} catch {
		return null;
	}
}

/** Fetch all registered users. Returns empty array on failure. */
export async function fetchUsers(filesUrl: string, authToken: string): Promise<AdminUser[]> {
	const baseUrl = normalizeBaseUrl(filesUrl);
	try {
		const res = await fetch(`${baseUrl}/api/admin/users`, {
			headers: { Authorization: `Bearer ${authToken}` },
		});
		if (!res.ok) return [];
		const data = (await res.json()) as { users: AdminUser[]; total: number };
		return data.users;
	} catch {
		return [];
	}
}

/** Kick a user from a channel. Throws on failure. */
export async function kickUser(
	filesUrl: string,
	authToken: string,
	channel: string,
	nick: string,
	reason?: string,
): Promise<void> {
	const baseUrl = normalizeBaseUrl(filesUrl);
	const body: Record<string, string> = { channel, nick };
	if (reason) body.reason = reason;

	const res = await fetch(`${baseUrl}/api/admin/kick`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${authToken}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(body),
	});

	if (!res.ok) {
		const text = await res.text().catch(() => '');
		throw new Error(`Kick failed (${res.status}): ${text}`);
	}
}

/** Ban a user from a channel. Throws on failure. */
export async function banUser(
	filesUrl: string,
	authToken: string,
	channel: string,
	nick: string,
	reason?: string,
	duration?: string,
): Promise<void> {
	const baseUrl = normalizeBaseUrl(filesUrl);
	const body: Record<string, string> = { channel, nick };
	if (reason) body.reason = reason;
	if (duration) body.duration = duration;

	const res = await fetch(`${baseUrl}/api/admin/ban`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${authToken}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(body),
	});

	if (!res.ok) {
		const text = await res.text().catch(() => '');
		throw new Error(`Ban failed (${res.status}): ${text}`);
	}
}

/** Fetch audit log entries. Returns null on failure. */
export async function fetchAuditLog(
	filesUrl: string,
	authToken: string,
	offset = 0,
	limit = 50,
): Promise<AuditResponse | null> {
	const baseUrl = normalizeBaseUrl(filesUrl);
	try {
		const res = await fetch(`${baseUrl}/api/admin/audit?offset=${offset}&limit=${limit}`, {
			headers: { Authorization: `Bearer ${authToken}` },
		});
		if (!res.ok) return null;
		return (await res.json()) as AuditResponse;
	} catch {
		return null;
	}
}

/** Filter users by search query (case-insensitive match on account or displayName). */
export function filterUsers(users: AdminUser[], query: string): AdminUser[] {
	if (!query.trim()) return users;
	const q = query.toLowerCase();
	return users.filter(
		(u) => u.account.toLowerCase().includes(q) || (u.displayName?.toLowerCase().includes(q) ?? false),
	);
}

/** Format uptime seconds into a human-readable string. */
export function formatUptime(seconds: number): string {
	const days = Math.floor(seconds / 86400);
	const hours = Math.floor((seconds % 86400) / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const parts: string[] = [];
	if (days > 0) parts.push(`${days}d`);
	if (hours > 0) parts.push(`${hours}h`);
	parts.push(`${minutes}m`);
	return parts.join(' ');
}
