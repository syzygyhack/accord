/**
 * Reactive connection state for the IRC WebSocket.
 *
 * Provides a Svelte 5 reactive wrapper around connection status so components
 * can bind to `connectionState.status` and react to changes without polling.
 */

import type { ConnectionState } from '../irc/connection';

interface ConnectionStore {
	status: ConnectionState;
	error: string | null;
	latency: number | null;
	reconnectAttempt: number;
	/** Whether the browser reports network connectivity (navigator.onLine). */
	isOnline: boolean;
	/** Whether message buffers were hydrated from IndexedDB cache. */
	hydratedFromCache: boolean;
}

/** Reactive connection state — components read this directly. */
export const connectionState: ConnectionStore = $state({
	status: 'disconnected',
	error: null,
	latency: null,
	reconnectAttempt: 0,
	isOnline: typeof navigator !== 'undefined' && navigator.onLine !== undefined ? navigator.onLine : true,
	hydratedFromCache: false,
});

/** Mark connection as established and clear any previous error. */
export function setConnected(): void {
	connectionState.status = 'connected';
	connectionState.error = null;
	connectionState.reconnectAttempt = 0;
}

/**
 * Mark connection as disconnected.
 * Optionally records the reason so UI can display it.
 */
export function setDisconnected(error?: string): void {
	connectionState.status = 'disconnected';
	connectionState.error = error ?? null;
	connectionState.latency = null;
}

/** Mark connection as attempting to reconnect. */
export function setReconnecting(attempt?: number): void {
	connectionState.status = 'reconnecting';
	if (attempt !== undefined) {
		connectionState.reconnectAttempt = attempt;
	}
}

/** Mark connection as in-progress (initial connect). */
export function setConnecting(): void {
	connectionState.status = 'connecting';
}

/** Update measured round-trip latency in milliseconds. */
export function setLatency(ms: number): void {
	connectionState.latency = ms;
}

/** Mark that message buffers were hydrated from IndexedDB cache. */
export function setHydratedFromCache(): void {
	connectionState.hydratedFromCache = true;
}

/**
 * Initialize navigator.onLine tracking.
 * Call once from the root component's $effect or onMount.
 * Returns a cleanup function to remove event listeners.
 */
export function initOnlineTracking(): () => void {
	if (typeof window === 'undefined') return () => {};

	function handleOnline(): void {
		connectionState.isOnline = true;
	}
	function handleOffline(): void {
		connectionState.isOnline = false;
	}

	window.addEventListener('online', handleOnline);
	window.addEventListener('offline', handleOffline);

	// Sync initial state
	connectionState.isOnline = navigator.onLine;

	return () => {
		window.removeEventListener('online', handleOnline);
		window.removeEventListener('offline', handleOffline);
	};
}
