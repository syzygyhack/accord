/**
 * Client-side API for account management (password change).
 *
 * Calls accord-files endpoints which proxy to Ergo's NickServ HTTP API.
 */

import { normalizeBaseUrl } from '$lib/utils/url';

export interface ChangePasswordRequest {
	currentPassword: string;
	newPassword: string;
}

export interface AccountApiResult {
	success: boolean;
	error?: string;
}

/**
 * Change the user's password via accord-files.
 *
 * Requires a valid JWT token and the current password for verification.
 */
export async function changePassword(
	filesUrl: string,
	token: string,
	req: ChangePasswordRequest,
): Promise<AccountApiResult> {
	const baseUrl = normalizeBaseUrl(filesUrl);

	try {
		const res = await fetch(`${baseUrl}/api/account/password`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify(req),
		});

		if (res.ok) {
			return { success: true };
		}

		const body = await res.json().catch(() => ({ error: 'Unknown error' })) as { error?: string };
		return { success: false, error: body.error ?? `Failed (${res.status})` };
	} catch {
		return { success: false, error: 'Network error — could not reach server' };
	}
}
