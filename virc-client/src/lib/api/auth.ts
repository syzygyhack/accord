/**
 * Auth helpers for virc-client.
 *
 * Credential storage strategy:
 *   - In Tauri builds: account name in localStorage (fast, non-sensitive),
 *     password in OS keychain via tauri-plugin-keyring (macOS Keychain,
 *     Windows Credential Manager, Linux Secret Service).
 *   - In web builds (no Tauri): both account and password in localStorage
 *     (browser sandboxed, no better alternative without a backend session).
 *
 * Auth flow:
 *   1. User logs in with account + password
 *   2. Credentials stored for SASL reconnect / JWT refresh
 *   3. POST /api/auth sends credentials to virc-files, receives JWT
 *   4. JWT auto-refreshes based on token expiry (default fallback: 50 minutes)
 */

const ACCOUNT_KEY = 'accord:account';

// Legacy key — used for migration and web fallback
const LEGACY_CREDENTIALS_KEY = 'accord:credentials';

// Keyring cleanup marker for logout in Tauri (best-effort deletion after reload)
const KEYRING_PENDING_DELETE_KEY = 'accord:keyring-pending-delete';

const KEYRING_SERVICE = 'accord';

export interface StoredCredentials {
	account: string;
	password: string;
}

// ---------------------------------------------------------------------------
// Tauri detection
// ---------------------------------------------------------------------------

/** Check if we're running inside Tauri (WebView2). */
function isTauri(): boolean {
	return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Dynamically import the keyring API. Returns null in non-Tauri environments.
 * Uses dynamic import so the module is only loaded when Tauri is available.
 */
async function getKeyring(): Promise<typeof import('tauri-plugin-keyring-api') | null> {
	if (!isTauri()) return null;
	try {
		return await import('tauri-plugin-keyring-api');
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Race a promise against a timeout. Rejects if the promise doesn't settle in time. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	return Promise.race([
		promise,
		new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms)),
	]);
}

/** Decode a JWT payload (URL-safe base64) without verification. */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
	const parts = token.split('.');
	if (parts.length !== 3) return null;
	const payload = parts[1];
	const padded = payload.replace(/-/g, '+').replace(/_/g, '/')
		.padEnd(Math.ceil(payload.length / 4) * 4, '=');
	if (typeof atob === 'undefined') return null;
	try {
		// atob is available in browser/Tauri webview
		const json = atob(padded);
		return JSON.parse(json) as Record<string, unknown>;
	} catch {
		return null;
	}
}

function getTokenExpiryMs(token: string): number | null {
	const payload = decodeJwtPayload(token);
	const exp = typeof payload?.exp === 'number' ? payload.exp
		: typeof payload?.exp === 'string' ? Number(payload.exp)
		: NaN;
	if (!Number.isFinite(exp)) return null;
	return exp * 1000;
}

/** Best-effort cleanup of any pending keyring deletion. */
async function cleanupPendingKeyringDelete(): Promise<void> {
	if (typeof localStorage === 'undefined') return;
	const pending = localStorage.getItem(KEYRING_PENDING_DELETE_KEY);
	if (!pending) return;
	const keyring = await getKeyring();
	if (!keyring) return;
	try {
		await withTimeout(keyring.deletePassword(KEYRING_SERVICE, pending), 3000);
		localStorage.removeItem(KEYRING_PENDING_DELETE_KEY);
	} catch {
		// Keep pending marker for retry on next startup
	}
}

// ---------------------------------------------------------------------------
// Credential storage
// ---------------------------------------------------------------------------

/** Check whether the user has stored credentials (i.e. is "logged in"). */
export function isAuthenticated(): boolean {
	if (typeof localStorage === 'undefined') return false;
	// Check new key first, then legacy
	return localStorage.getItem(ACCOUNT_KEY) !== null
		|| localStorage.getItem(LEGACY_CREDENTIALS_KEY) !== null;
}

/**
 * Store credentials after successful login.
 * Always writes to localStorage first (synchronous, reliable).
 * In Tauri: also attempts to store password in OS keychain in the background.
 */
export async function storeCredentials(creds: StoredCredentials): Promise<void> {
	// Always write to localStorage — sync, reliable, works even if keyring IPC fails
	localStorage.setItem(ACCOUNT_KEY, creds.account);
	localStorage.setItem(LEGACY_CREDENTIALS_KEY, JSON.stringify(creds));
	// Clear any pending keyring deletion (user is logging in again)
	localStorage.removeItem(KEYRING_PENDING_DELETE_KEY);

	// Attempt keyring upgrade (non-blocking — don't let IPC failure stall login)
	const keyring = await getKeyring();
	if (keyring) {
		try {
			await withTimeout(keyring.setPassword(KEYRING_SERVICE, creds.account, creds.password), 3000);
			// Keyring succeeded — remove localStorage password copy
			localStorage.removeItem(LEGACY_CREDENTIALS_KEY);
		} catch {
			// Keyring failed — localStorage fallback already in place
		}
	}
}

/**
 * Retrieve stored credentials, or null if not logged in.
 * Tries OS keychain first (with timeout), then falls back to localStorage.
 */
export async function getCredentials(): Promise<StoredCredentials | null> {
	if (typeof localStorage === 'undefined') return null;

	// Best-effort cleanup of any pending keyring deletion (no-op if none)
	void cleanupPendingKeyringDelete();

	const account = localStorage.getItem(ACCOUNT_KEY);

	// Try keychain first (with timeout so IPC failures don't stall)
	if (account) {
		const keyring = await getKeyring();
		if (keyring) {
			try {
				const password = await withTimeout(keyring.getPassword(KEYRING_SERVICE, account), 3000);
				if (password) return { account, password };
			} catch {
				// Keyring failed or timed out — fall through to localStorage
			}
		}
	}

	// Fall back to localStorage
	const raw = localStorage.getItem(LEGACY_CREDENTIALS_KEY);
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw) as StoredCredentials;
		if (typeof parsed.account !== 'string' || typeof parsed.password !== 'string') {
			localStorage.removeItem(LEGACY_CREDENTIALS_KEY);
			return null;
		}
		// Ensure account key is set
		if (!account) localStorage.setItem(ACCOUNT_KEY, parsed.account);
		return parsed;
	} catch {
		localStorage.removeItem(LEGACY_CREDENTIALS_KEY);
		return null;
	}
}

/** Clear credentials (logout). */
export async function clearCredentials(): Promise<void> {
	if (typeof localStorage === 'undefined') return;
	const account = localStorage.getItem(ACCOUNT_KEY);

	// Clear localStorage first (sync, reliable)
	localStorage.removeItem(ACCOUNT_KEY);
	localStorage.removeItem(LEGACY_CREDENTIALS_KEY);

	// If running in Tauri, mark pending keyring deletion so a hard reload
	// still ensures cleanup on next startup.
	if (account && isTauri()) {
		localStorage.setItem(KEYRING_PENDING_DELETE_KEY, account);
	} else {
		localStorage.removeItem(KEYRING_PENDING_DELETE_KEY);
	}

	// Best-effort keychain cleanup (with timeout)
	if (account) {
		const keyring = await getKeyring();
		if (keyring) {
			try {
				await withTimeout(keyring.deletePassword(KEYRING_SERVICE, account), 3000);
				localStorage.removeItem(KEYRING_PENDING_DELETE_KEY);
			} catch {
				// Keyring failed — localStorage already cleared
			}
		}
	}
}

// ---------------------------------------------------------------------------
// JWT management
// ---------------------------------------------------------------------------

/** Module-level JWT — not persisted to storage (short-lived). */
let currentToken: string | null = null;
let currentTokenExpiryMs: number | null = null;

/** Handle for the auto-refresh timer so we can cancel it. */
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let refreshStopped = false;

/** 50 minutes in milliseconds — leaves 10-minute buffer before 1-hour expiry. */
const DEFAULT_REFRESH_INTERVAL_MS = 50 * 60 * 1000;
const REFRESH_BUFFER_MS = 10 * 60 * 1000;
const MIN_REFRESH_INTERVAL_MS = 60 * 1000;

function setCurrentToken(token: string | null): void {
	currentToken = token;
	currentTokenExpiryMs = token ? getTokenExpiryMs(token) : null;
}

function computeRefreshDelay(): number {
	if (!currentTokenExpiryMs) return DEFAULT_REFRESH_INTERVAL_MS;
	const target = currentTokenExpiryMs - REFRESH_BUFFER_MS;
	const delay = target - Date.now();
	return Math.max(MIN_REFRESH_INTERVAL_MS, delay);
}

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
	setCurrentToken(data.token);
	return data.token;
}

/** Return the current JWT, or null if none has been fetched. */
export function getToken(): string | null {
	return currentToken;
}

/**
 * Start a refresh loop that re-fetches the JWT using stored
 * credentials, scheduled from the token expiry (with a safety buffer).
 * Call after initial login succeeds.
 *
 * Does nothing if no credentials are stored.
 */
export function startTokenRefresh(serverUrl: string, onRefreshFailed?: () => void): void {
	stopTokenRefresh();
	refreshStopped = false;

	const schedule = (delayMs: number) => {
		refreshTimer = setTimeout(async () => {
			if (refreshStopped) return;
			const creds = await getCredentials();
			if (!creds) {
				stopTokenRefresh();
				onRefreshFailed?.();
				return;
			}

			try {
				await fetchToken(serverUrl, creds.account, creds.password);
				if (refreshStopped) return;
				// Schedule based on new token expiry
				schedule(computeRefreshDelay());
			} catch {
				if (refreshStopped) return;
				// Refresh failed — token may be expired or service unavailable.
				onRefreshFailed?.();
				// Keep trying on the default interval
				schedule(DEFAULT_REFRESH_INTERVAL_MS);
			}
		}, delayMs);
	};

	schedule(computeRefreshDelay());
}

/** Stop the JWT refresh timer. */
export function stopTokenRefresh(): void {
	refreshStopped = true;
	if (refreshTimer !== null) {
		clearTimeout(refreshTimer);
		refreshTimer = null;
	}
}

/** Clear the in-memory JWT (e.g. on logout). */
export function clearToken(): void {
	setCurrentToken(null);
	stopTokenRefresh();
}
