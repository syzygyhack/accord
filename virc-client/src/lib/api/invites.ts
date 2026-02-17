/**
 * Client-side API for managing server invites via virc-files.
 *
 * Endpoints:
 *   GET    /api/invite         — list all invites
 *   POST   /api/invite         — create invite
 *   DELETE /api/invite/:token  — delete invite
 */

import { normalizeBaseUrl } from '$lib/utils/url';

export interface InviteSummary {
	token: string;
	channel: string;
	createdBy: string;
	expiresAt: number;
	maxUses: number;
	useCount: number;
	expired: boolean;
	maxUsesReached: boolean;
}

export interface CreateInviteResult {
	token: string;
	url: string;
	channel: string;
	expiresAt: number;
	maxUses: number;
}

/** Fetch all invites from virc-files. Returns empty array on failure. */
export async function listInvites(filesUrl: string, authToken: string): Promise<InviteSummary[]> {
	const baseUrl = normalizeBaseUrl(filesUrl);
	try {
		const res = await fetch(`${baseUrl}/api/invite`, {
			headers: { Authorization: `Bearer ${authToken}` },
		});
		if (!res.ok) return [];
		const data = (await res.json()) as { invites: InviteSummary[] };
		return data.invites;
	} catch {
		return [];
	}
}

/** Create a new invite. Throws on failure. */
export async function createInvite(
	filesUrl: string,
	authToken: string,
	channel: string,
	expiresIn?: string,
	maxUses?: number,
): Promise<CreateInviteResult> {
	const baseUrl = normalizeBaseUrl(filesUrl);
	const body: Record<string, unknown> = { channel };
	if (expiresIn) body.expiresIn = expiresIn;
	if (maxUses !== undefined) body.maxUses = maxUses;

	const res = await fetch(`${baseUrl}/api/invite`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${authToken}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(body),
	});

	if (!res.ok) {
		const text = await res.text().catch(() => '');
		throw new Error(`Failed to create invite (${res.status}): ${text}`);
	}

	return (await res.json()) as CreateInviteResult;
}

/** Delete an invite by token. Throws on failure. */
export async function deleteInvite(filesUrl: string, authToken: string, inviteToken: string): Promise<void> {
	const baseUrl = normalizeBaseUrl(filesUrl);
	const res = await fetch(`${baseUrl}/api/invite/${encodeURIComponent(inviteToken)}`, {
		method: 'DELETE',
		headers: { Authorization: `Bearer ${authToken}` },
	});

	if (!res.ok) {
		const text = await res.text().catch(() => '');
		throw new Error(`Failed to delete invite (${res.status}): ${text}`);
	}
}
