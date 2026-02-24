import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	serverConfig,
	setServerConfig,
	resetServerConfig,
	getRoleColor,
	getCachedConfig,
	setCachedConfig,
	type AccordConfig,
} from './serverConfig.svelte';

/**
 * Minimal localStorage mock for Node-based vitest.
 */
function createStorageMock() {
	const store = new Map<string, string>();
	return {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => store.set(key, value),
		removeItem: (key: string) => store.delete(key),
		clear: () => store.clear(),
		get length() { return store.size; },
		key: (_index: number) => null,
	} as Storage;
}

describe('serverConfig state', () => {
	beforeEach(() => {
		resetServerConfig();
	});

	it('starts with null config', () => {
		expect(serverConfig.config).toBeNull();
	});

	it('stores config via setServerConfig', () => {
		const config: AccordConfig = {
			name: 'Test Server',
			description: 'A test server',
		};
		setServerConfig(config);
		expect(serverConfig.config).toEqual(config);
	});

	it('exposes all AccordConfig fields', () => {
		const config: AccordConfig = {
			name: 'My Community',
			icon: '/assets/icon.png',
			description: 'Welcome to my community',
			welcome: { message: 'Hello!' },
			channels: {
				categories: [
					{ name: 'Text', channels: ['#general', '#dev'] },
					{ name: 'Voice', channels: ['#voice'], voice: true },
				],
			},
		};
		setServerConfig(config);
		expect(serverConfig.config?.name).toBe('My Community');
		expect(serverConfig.config?.icon).toBe('/assets/icon.png');
		expect(serverConfig.config?.description).toBe('Welcome to my community');
		expect(serverConfig.config?.welcome?.message).toBe('Hello!');
		expect(serverConfig.config?.channels?.categories).toHaveLength(2);
	});

	it('resetServerConfig clears to null', () => {
		setServerConfig({ name: 'Test' });
		resetServerConfig();
		expect(serverConfig.config).toBeNull();
	});

	it('overwrites previous config on subsequent set', () => {
		setServerConfig({ name: 'First' });
		setServerConfig({ name: 'Second', description: 'Updated' });
		expect(serverConfig.config?.name).toBe('Second');
		expect(serverConfig.config?.description).toBe('Updated');
	});

	it('stores readonly category flag from accord.json', () => {
		const config: AccordConfig = {
			name: 'Info Server',
			channels: {
				categories: [
					{ name: 'Text', channels: ['#general'] },
					{ name: 'Info', channels: ['#rules', '#welcome'], readonly: true },
				],
			},
		};
		setServerConfig(config);
		const cats = serverConfig.config?.channels?.categories;
		expect(cats).toHaveLength(2);
		expect(cats?.[0].readonly).toBeUndefined();
		expect(cats?.[1].readonly).toBe(true);
	});

	it('stores roles field from accord.json', () => {
		const config: AccordConfig = {
			name: 'Roles Server',
			roles: {
				'~': { name: 'Owner', color: '#e0a040' },
				'@': { name: 'Mod', color: '#50a0e0' },
				'+': { name: 'Regular', color: null },
			},
		};
		setServerConfig(config);
		expect(serverConfig.config?.roles).toBeDefined();
		expect(serverConfig.config?.roles?.['~']?.name).toBe('Owner');
		expect(serverConfig.config?.roles?.['@']?.color).toBe('#50a0e0');
		expect(serverConfig.config?.roles?.['+']?.color).toBeNull();
	});

	it('stores theme field with accent and surfaces', () => {
		const config: AccordConfig = {
			name: 'Themed Server',
			theme: {
				accent: '#e05050',
				surfaces: {
					lowest: '#1a1015',
					low: '#201520',
					base: '#281a28',
				},
			},
		};
		setServerConfig(config);
		expect(serverConfig.config?.theme).toBeDefined();
		expect(serverConfig.config?.theme?.accent).toBe('#e05050');
		expect(serverConfig.config?.theme?.surfaces?.lowest).toBe('#1a1015');
		expect(serverConfig.config?.theme?.surfaces?.low).toBe('#201520');
		expect(serverConfig.config?.theme?.surfaces?.base).toBe('#281a28');
	});

	it('stores theme with accent only', () => {
		const config: AccordConfig = {
			name: 'Accent Server',
			theme: { accent: '#ff6600' },
		};
		setServerConfig(config);
		expect(serverConfig.config?.theme?.accent).toBe('#ff6600');
		expect(serverConfig.config?.theme?.surfaces).toBeUndefined();
	});

	it('config without theme has undefined theme', () => {
		const config: AccordConfig = { name: 'No Theme' };
		setServerConfig(config);
		expect(serverConfig.config?.theme).toBeUndefined();
	});
});

describe('getRoleColor', () => {
	beforeEach(() => {
		resetServerConfig();
	});

	it('returns null for null mode', () => {
		expect(getRoleColor(null)).toBeNull();
	});

	it('returns default color for owner mode when no config', () => {
		expect(getRoleColor('~')).toBe('#e0a040');
	});

	it('returns default color for admin mode when no config', () => {
		expect(getRoleColor('&')).toBe('#e05050');
	});

	it('returns default color for op mode when no config', () => {
		expect(getRoleColor('@')).toBe('#50a0e0');
	});

	it('returns null for + mode (no default color)', () => {
		expect(getRoleColor('+')).toBeNull();
	});

	it('returns null for unknown mode', () => {
		expect(getRoleColor('?')).toBeNull();
	});

	it('uses accord.json roles when config is set', () => {
		setServerConfig({
			name: 'Custom',
			roles: {
				'~': { name: 'Founder', color: '#ff0000' },
				'@': { name: 'Mod', color: '#00ff00' },
				'+': { name: 'VIP', color: '#0000ff' },
			},
		});
		expect(getRoleColor('~')).toBe('#ff0000');
		expect(getRoleColor('@')).toBe('#00ff00');
		expect(getRoleColor('+')).toBe('#0000ff');
	});

	it('returns null when accord.json role has null color', () => {
		setServerConfig({
			name: 'Custom',
			roles: {
				'@': { name: 'Mod', color: null },
			},
		});
		expect(getRoleColor('@')).toBeNull();
	});

	it('returns null for mode not in accord.json roles', () => {
		setServerConfig({
			name: 'Custom',
			roles: {
				'@': { name: 'Mod', color: '#50a0e0' },
			},
		});
		// '~' is not in custom roles, but custom roles override ALL defaults
		expect(getRoleColor('~')).toBeNull();
	});

	it('rejects CSS injection in role colors', () => {
		setServerConfig({
			name: 'Evil',
			roles: {
				'~': { name: 'Owner', color: 'red; background-image: url(evil)' },
				'@': { name: 'Mod', color: '#50a0e0' },
				'%': { name: 'Helper', color: 'rgb(255, 0, 0)' },
				'+': { name: 'Member', color: 'hsl(120, 50%, 50%)' },
			},
		});
		// Malicious value blocked
		expect(getRoleColor('~')).toBeNull();
		// Valid hex passes
		expect(getRoleColor('@')).toBe('#50a0e0');
		// Valid rgb passes
		expect(getRoleColor('%')).toBe('rgb(255, 0, 0)');
		// Valid hsl passes
		expect(getRoleColor('+')).toBe('hsl(120, 50%, 50%)');
		resetServerConfig();
	});

	it('reverts to defaults after resetServerConfig', () => {
		setServerConfig({
			name: 'Custom',
			roles: {
				'~': { name: 'Founder', color: '#ff0000' },
			},
		});
		expect(getRoleColor('~')).toBe('#ff0000');
		resetServerConfig();
		expect(getRoleColor('~')).toBe('#e0a040');
	});
});

describe('ETag caching', () => {
	beforeEach(() => {
		vi.stubGlobal('localStorage', createStorageMock());
		resetServerConfig();
	});

	it('getCachedConfig returns null when nothing is cached', () => {
		expect(getCachedConfig()).toBeNull();
	});

	it('setCachedConfig stores config and etag in localStorage', () => {
		const config: AccordConfig = { name: 'Cached Server' };
		setCachedConfig(config, '"abc123"');
		expect(localStorage.getItem('accord:config-etag')).toBe('"abc123"');
		expect(localStorage.getItem('accord:config-cache')).toBe(JSON.stringify(config));
	});

	it('getCachedConfig retrieves stored config and etag', () => {
		const config: AccordConfig = { name: 'Cached Server', description: 'test' };
		setCachedConfig(config, '"etag-1"');
		const cached = getCachedConfig();
		expect(cached).not.toBeNull();
		expect(cached!.etag).toBe('"etag-1"');
		expect(cached!.config.name).toBe('Cached Server');
		expect(cached!.config.description).toBe('test');
	});

	it('setCachedConfig updates the cachedETag field on the store', () => {
		expect(serverConfig.cachedETag).toBeNull();
		setCachedConfig({ name: 'Test' }, '"etag-2"');
		expect(serverConfig.cachedETag).toBe('"etag-2"');
	});

	it('resetServerConfig clears cachedETag', () => {
		setCachedConfig({ name: 'Test' }, '"etag-3"');
		expect(serverConfig.cachedETag).toBe('"etag-3"');
		resetServerConfig();
		expect(serverConfig.cachedETag).toBeNull();
	});

	it('getCachedConfig returns null if only etag is set (no config)', () => {
		localStorage.setItem('accord:config-etag', '"partial"');
		expect(getCachedConfig()).toBeNull();
	});

	it('getCachedConfig returns null if only config is set (no etag)', () => {
		localStorage.setItem('accord:config-cache', '{"name":"Partial"}');
		expect(getCachedConfig()).toBeNull();
	});

	it('getCachedConfig returns null for corrupted JSON in localStorage', () => {
		localStorage.setItem('accord:config-etag', '"corrupt"');
		localStorage.setItem('accord:config-cache', '{not valid json');
		expect(getCachedConfig()).toBeNull();
	});
});
