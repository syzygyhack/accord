/**
 * Reactive presence state for MONITOR online/offline tracking.
 *
 * Tracks which nicks are currently online based on MONITOR responses
 * (RPL_MONONLINE 730 / RPL_MONOFFLINE 731).
 */

interface PresenceStore {
	online: Set<string>; // nicks currently online
}

/** Reactive presence store — components read this directly. */
export const presenceState: PresenceStore = $state({
	online: new Set(),
});

/** Mark nicks as online. */
export function setOnline(nicks: string[]): void {
	for (const nick of nicks) {
		presenceState.online.add(nick);
	}
}

/** Mark nicks as offline. */
export function setOffline(nicks: string[]): void {
	for (const nick of nicks) {
		presenceState.online.delete(nick);
	}
}

/** Check if a nick is online. */
export function isOnline(nick: string): boolean {
	return presenceState.online.has(nick);
}

/** Reset all presence state. */
export function resetPresence(): void {
	presenceState.online.clear();
}
