/**
 * Reactive user/auth state for the current session.
 *
 * Credentials are persisted in sessionStorage so they survive page reloads
 * but are cleared when the tab closes. This supports SASL reconnect and
 * JWT refresh without re-prompting the user.
 */

import {
	storeCredentials,
	getCredentials,
	clearCredentials,
	type StoredCredentials,
} from '../api/auth';

interface UserStore {
	account: string | null;
	nick: string | null;
}

/** Reactive user state — components read this directly. */
export const userState: UserStore = $state({
	account: null,
	nick: null,
});

/**
 * Whether the user is authenticated (has a stored account).
 * Svelte 5 does not allow exporting `$derived` from modules, so this
 * is exposed as a function. Inside a component's reactive context,
 * calling `isAuthenticated()` will still track reactively.
 */
export function isAuthenticated(): boolean {
	return userState.account !== null;
}

/**
 * Log the user in: store credentials in sessionStorage and update
 * reactive state. Does NOT perform SASL or JWT — callers handle that.
 */
export function login(account: string, password: string): void {
	storeCredentials({ account, password });
	userState.account = account;
	userState.nick = account; // Nick defaults to account name until server confirms
}

/**
 * Clear session: remove stored credentials and reset reactive state.
 */
export function logout(): void {
	clearCredentials();
	userState.account = null;
	userState.nick = null;
}

/**
 * Update the confirmed nick (e.g. after RPL_WELCOME or NICK change).
 */
export function setNick(nick: string): void {
	userState.nick = nick;
}

/**
 * Retrieve stored credentials for SASL reconnect or JWT refresh.
 * Returns null if no credentials are stored.
 */
export function getStoredCredentials(): StoredCredentials | null {
	return getCredentials();
}

/**
 * Restore reactive state from sessionStorage on app start.
 * Call once during initialization to rehydrate after page reload.
 */
export function rehydrate(): void {
	const creds = getCredentials();
	if (creds) {
		userState.account = creds.account;
		userState.nick = creds.account;
	}
}
