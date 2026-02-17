/**
 * Reactive server state for the server list.
 *
 * Tracks connected servers and which one is active. MVP supports a
 * single server; the data model supports multiple for future use.
 * Server order is persisted to localStorage.
 */

import { hasLocalStorage } from '$lib/utils/storage';

export interface ServerInfo {
	id: string;
	name: string;
	url: string;
	filesUrl: string | null;
	icon: string | null;
}

interface ServerStore {
	servers: ServerInfo[];
	activeServerId: string | null;
}

const SERVER_ORDER_KEY = 'accord:serverOrder';

/** Load saved server order from localStorage. Returns empty array if none. */
function loadServerOrder(): string[] {
	if (!hasLocalStorage()) return [];
	try {
		const stored = localStorage.getItem(SERVER_ORDER_KEY);
		if (stored) {
			const parsed = JSON.parse(stored);
			if (Array.isArray(parsed)) return parsed;
		}
	} catch {
		// Corrupt localStorage — ignore
	}
	return [];
}

/** Persist current server order to localStorage. */
function saveServerOrder(): void {
	if (!hasLocalStorage()) return;
	try {
		const ids = serverState.servers.map((s) => s.id);
		localStorage.setItem(SERVER_ORDER_KEY, JSON.stringify(ids));
	} catch {
		// Storage full or unavailable
	}
}

/** Reactive server store — components read this directly. */
export const serverState: ServerStore = $state({
	servers: [],
	activeServerId: null,
});

/** Add a server to the list and make it active. */
export function addServer(server: ServerInfo): void {
	const existing = serverState.servers.find((s) => s.id === server.id);
	if (!existing) {
		// Insert at position from saved order, or append at end
		const savedOrder = loadServerOrder();
		const savedIdx = savedOrder.indexOf(server.id);
		if (savedIdx >= 0 && savedIdx < serverState.servers.length) {
			serverState.servers.splice(savedIdx, 0, server);
		} else {
			serverState.servers.push(server);
		}
		saveServerOrder();
	}
	serverState.activeServerId = server.id;
}

/** Set the active server by ID. */
export function setActiveServer(id: string): void {
	if (serverState.servers.some((s) => s.id === id)) {
		serverState.activeServerId = id;
	}
}

/** Get the currently active server, or null if none. */
export function getActiveServer(): ServerInfo | null {
	if (!serverState.activeServerId) return null;
	return serverState.servers.find((s) => s.id === serverState.activeServerId) ?? null;
}

/** Update server info (e.g. after fetching virc.json). */
export function updateServer(id: string, updates: Partial<Omit<ServerInfo, 'id'>>): void {
	const server = serverState.servers.find((s) => s.id === id);
	if (server) {
		if (updates.name !== undefined) server.name = updates.name;
		if (updates.url !== undefined) server.url = updates.url;
		if (updates.filesUrl !== undefined) server.filesUrl = updates.filesUrl;
		if (updates.icon !== undefined) server.icon = updates.icon;
	}
}

/** Remove a server from the list. Adjusts active server if needed. */
export function removeServer(id: string): void {
	const idx = serverState.servers.findIndex((s) => s.id === id);
	if (idx < 0) return;
	serverState.servers.splice(idx, 1);
	if (serverState.activeServerId === id) {
		serverState.activeServerId = serverState.servers[0]?.id ?? null;
	}
	saveServerOrder();
}

/**
 * Reorder servers by moving a server from one index to another.
 * Persists the new order to localStorage.
 */
export function reorderServers(fromIndex: number, toIndex: number): void {
	const servers = serverState.servers;
	if (fromIndex < 0 || fromIndex >= servers.length) return;
	if (toIndex < 0 || toIndex >= servers.length) return;
	if (fromIndex === toIndex) return;
	const [moved] = servers.splice(fromIndex, 1);
	servers.splice(toIndex, 0, moved);
	saveServerOrder();
}

/** Reset all server state. */
export function resetServers(): void {
	serverState.servers.length = 0;
	serverState.activeServerId = null;
}

/** Clear persisted server order from localStorage. */
export function resetServerOrder(): void {
	if (hasLocalStorage()) {
		localStorage.removeItem(SERVER_ORDER_KEY);
	}
}
