import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
	serverState,
	addServer,
	setActiveServer,
	getActiveServer,
	updateServer,
	removeServer,
	reorderServers,
	resetServers,
	resetServerOrder,
	type ServerInfo,
} from './servers.svelte';

function makeServer(id: string, name?: string): ServerInfo {
	return {
		id,
		name: name ?? `Server ${id}`,
		url: `wss://${id}.example.com`,
		filesUrl: null,
		icon: null,
	};
}

/**
 * Minimal localStorage mock — vitest runs in Node where localStorage
 * is not available by default.
 */
function createLocalStorageMock() {
	const store = new Map<string, string>();
	return {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => store.set(key, value),
		removeItem: (key: string) => store.delete(key),
		clear: () => store.clear(),
		get length() {
			return store.size;
		},
		key: (_index: number) => null,
	} as Storage;
}

describe('servers state', () => {
	beforeEach(() => {
		resetServers();
	});

	describe('addServer', () => {
		it('adds a server and makes it active', () => {
			addServer(makeServer('a'));
			expect(serverState.servers).toHaveLength(1);
			expect(serverState.activeServerId).toBe('a');
		});

		it('does not duplicate servers with the same id', () => {
			addServer(makeServer('a'));
			addServer(makeServer('a'));
			expect(serverState.servers).toHaveLength(1);
		});

		it('can add multiple servers', () => {
			addServer(makeServer('a'));
			addServer(makeServer('b'));
			expect(serverState.servers).toHaveLength(2);
			expect(serverState.activeServerId).toBe('b');
		});
	});

	describe('setActiveServer', () => {
		it('sets the active server', () => {
			addServer(makeServer('a'));
			addServer(makeServer('b'));
			setActiveServer('a');
			expect(serverState.activeServerId).toBe('a');
		});

		it('ignores unknown server ids', () => {
			addServer(makeServer('a'));
			setActiveServer('nonexistent');
			expect(serverState.activeServerId).toBe('a');
		});
	});

	describe('getActiveServer', () => {
		it('returns null when no servers', () => {
			expect(getActiveServer()).toBeNull();
		});

		it('returns the active server', () => {
			addServer(makeServer('a', 'Alpha'));
			const active = getActiveServer();
			expect(active?.id).toBe('a');
			expect(active?.name).toBe('Alpha');
		});
	});

	describe('updateServer', () => {
		it('updates server properties', () => {
			addServer(makeServer('a'));
			updateServer('a', { name: 'New Name' });
			expect(serverState.servers[0].name).toBe('New Name');
		});

		it('ignores unknown ids', () => {
			addServer(makeServer('a'));
			updateServer('nope', { name: 'Nope' });
			expect(serverState.servers[0].name).toBe('Server a');
		});
	});

	describe('removeServer', () => {
		it('removes a server by id', () => {
			addServer(makeServer('a'));
			addServer(makeServer('b'));
			removeServer('a');
			expect(serverState.servers).toHaveLength(1);
			expect(serverState.servers[0].id).toBe('b');
		});

		it('adjusts active server when removing the active one', () => {
			addServer(makeServer('a'));
			addServer(makeServer('b'));
			setActiveServer('a');
			removeServer('a');
			expect(serverState.activeServerId).toBe('b');
		});

		it('sets active to null when removing the last server', () => {
			addServer(makeServer('a'));
			removeServer('a');
			expect(serverState.activeServerId).toBeNull();
			expect(serverState.servers).toHaveLength(0);
		});

		it('ignores unknown ids', () => {
			addServer(makeServer('a'));
			removeServer('nonexistent');
			expect(serverState.servers).toHaveLength(1);
		});

		it('keeps active unchanged when removing non-active server', () => {
			addServer(makeServer('a'));
			addServer(makeServer('b'));
			setActiveServer('b');
			removeServer('a');
			expect(serverState.activeServerId).toBe('b');
		});
	});

	describe('reorderServers', () => {
		it('moves a server from one index to another', () => {
			addServer(makeServer('a'));
			addServer(makeServer('b'));
			addServer(makeServer('c'));
			reorderServers(0, 2);
			expect(serverState.servers.map((s) => s.id)).toEqual(['b', 'c', 'a']);
		});

		it('moves backward correctly', () => {
			addServer(makeServer('a'));
			addServer(makeServer('b'));
			addServer(makeServer('c'));
			reorderServers(2, 0);
			expect(serverState.servers.map((s) => s.id)).toEqual(['c', 'a', 'b']);
		});

		it('no-ops when from equals to', () => {
			addServer(makeServer('a'));
			addServer(makeServer('b'));
			reorderServers(0, 0);
			expect(serverState.servers.map((s) => s.id)).toEqual(['a', 'b']);
		});

		it('ignores out-of-range indices', () => {
			addServer(makeServer('a'));
			addServer(makeServer('b'));
			reorderServers(-1, 0);
			expect(serverState.servers.map((s) => s.id)).toEqual(['a', 'b']);
			reorderServers(0, 5);
			expect(serverState.servers.map((s) => s.id)).toEqual(['a', 'b']);
		});
	});

	describe('resetServers', () => {
		it('clears all servers and active', () => {
			addServer(makeServer('a'));
			addServer(makeServer('b'));
			resetServers();
			expect(serverState.servers).toHaveLength(0);
			expect(serverState.activeServerId).toBeNull();
		});
	});

	describe('localStorage persistence', () => {
		let storage: Storage;

		beforeEach(() => {
			storage = createLocalStorageMock();
			vi.stubGlobal('localStorage', storage);
			resetServers();
			resetServerOrder();
		});

		afterEach(() => {
			vi.unstubAllGlobals();
		});

		it('saves server order when adding a server', () => {
			addServer(makeServer('a'));
			addServer(makeServer('b'));
			const stored = JSON.parse(storage.getItem('virc:serverOrder')!);
			expect(stored).toEqual(['a', 'b']);
		});

		it('saves server order when reordering', () => {
			addServer(makeServer('a'));
			addServer(makeServer('b'));
			addServer(makeServer('c'));
			reorderServers(0, 2);
			const stored = JSON.parse(storage.getItem('virc:serverOrder')!);
			expect(stored).toEqual(['b', 'c', 'a']);
		});

		it('saves server order when removing', () => {
			addServer(makeServer('a'));
			addServer(makeServer('b'));
			addServer(makeServer('c'));
			removeServer('b');
			const stored = JSON.parse(storage.getItem('virc:serverOrder')!);
			expect(stored).toEqual(['a', 'c']);
		});

		it('resetServerOrder clears localStorage', () => {
			addServer(makeServer('a'));
			expect(storage.getItem('virc:serverOrder')).not.toBeNull();
			resetServerOrder();
			expect(storage.getItem('virc:serverOrder')).toBeNull();
		});
	});
});
