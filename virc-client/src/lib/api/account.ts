/**
 * Client-side API for account management (password, email).
 *
 * Calls virc-files endpoints which proxy to Ergo's NickServ HTTP API.
 */

export interface ChangePasswordRequest {
	currentPassword: string;
	newPassword: string;
}

export interface ChangeEmailRequest {
	email: string;
}

export interface AccountApiResult {
	success: boolean;
	error?: string;
}

/**
 * Change the user's password via virc-files.
 *
 * Requires a valid JWT token and the current password for verification.
 */
export async function changePassword(
	filesUrl: string,
	token: string,
	req: ChangePasswordRequest,
): Promise<AccountApiResult> {
	const baseUrl = filesUrl.replace(/\/+$/, '');

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

/**
 * Set or change the user's email via virc-files.
 *
 * Requires a valid JWT token.
 */
export async function changeEmail(
	filesUrl: string,
	token: string,
	req: ChangeEmailRequest,
): Promise<AccountApiResult> {
	const baseUrl = filesUrl.replace(/\/+$/, '');

	try {
		const res = await fetch(`${baseUrl}/api/account/email`, {
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
