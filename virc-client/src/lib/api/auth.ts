/**
 * Auth helpers for virc-client.
 *
 * Credentials live in sessionStorage (survives reload, cleared on tab close).
 * JWT is stored in a module-level variable (short-lived, not localStorage).
 *
 * Auth flow:
 *   1. User logs in with account + password
 *   2. Credentials stored in sessionStorage for SASL reconnect / JWT refresh
 *   3. POST /api/auth sends credentials to virc-files, receives JWT
 *   4. JWT auto-refreshes on a 50-minute timer using stored credentials
 */

const CREDENTIALS_KEY = 'virc:credentials';

export interface StoredCredentials {
	account: string;
	password: string;
}

/** Check whether the user has stored credentials (i.e. is "logged in"). */
export function isAuthenticated(): boolean {
	if (typeof sessionStorage === 'undefined') return false;
	return sessionStorage.getItem(CREDENTIALS_KEY) !== null;
}

/** Store credentials after successful login. */
export function storeCredentials(creds: StoredCredentials): void {
	sessionStorage.setItem(CREDENTIALS_KEY, JSON.stringify(creds));
}

/** Retrieve stored credentials, or null if not logged in. */
export function getCredentials(): StoredCredentials | null {
	if (typeof sessionStorage === 'undefined') return null;
	const raw = sessionStorage.getItem(CREDENTIALS_KEY);
	if (!raw) return null;
	return JSON.parse(raw) as StoredCredentials;
}

/** Clear credentials (logout). */
export function clearCredentials(): void {
	sessionStorage.removeItem(CREDENTIALS_KEY);
}

// ---------------------------------------------------------------------------
// JWT management
// ---------------------------------------------------------------------------

/** Module-level JWT — not persisted to storage (short-lived). */
let currentToken: string | null = null;

/** Handle for the auto-refresh timer so we can cancel it. */
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

/** 50 minutes in milliseconds — leaves 10-minute buffer before 1-hour expiry. */
const REFRESH_INTERVAL_MS = 50 * 60 * 1000;

/**
 * Fetch a JWT from virc-files by posting credentials.
 * Stores the token in memory and returns it.
 *
 * @throws {Error} if the server returns a non-OK response.
 */
export async function fetchToken(
	serverUrl: string,
	account: string,
	password: string,
): Promise<string> {
	const res = await fetch(`${serverUrl}/api/auth`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ account, password }),
	});

	if (!res.ok) {
		const body = await res.text().catch(() => '');
		throw new Error(`Auth failed (${res.status}): ${body}`);
	}

	const data = (await res.json()) as { token: string };
	currentToken = data.token;
	return data.token;
}

/** Return the current JWT, or null if none has been fetched. */
export function getToken(): string | null {
	return currentToken;
}

/**
 * Start a 50-minute refresh loop that re-fetches the JWT using stored
 * credentials. Call after initial login succeeds.
 *
 * Does nothing if no credentials are stored.
 */
export function startTokenRefresh(serverUrl: string): void {
	stopTokenRefresh();

	refreshTimer = setInterval(async () => {
		const creds = getCredentials();
		if (!creds) {
			stopTokenRefresh();
			return;
		}

		try {
			await fetchToken(serverUrl, creds.account, creds.password);
		} catch {
			// Refresh failed — token will expire. Connection layer handles
			// re-auth on next attempt.
		}
	}, REFRESH_INTERVAL_MS);
}

/** Stop the JWT refresh timer. */
export function stopTokenRefresh(): void {
	if (refreshTimer !== null) {
		clearInterval(refreshTimer);
		refreshTimer = null;
	}
}

/** Clear the in-memory JWT (e.g. on logout). */
export function clearToken(): void {
	currentToken = null;
	stopTokenRefresh();
}
