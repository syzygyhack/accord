import { describe, it, expect, beforeEach } from 'vitest';
import {
	serverConfig,
	setServerConfig,
	resetServerConfig,
	type VircConfig,
} from './serverConfig.svelte';

describe('serverConfig state', () => {
	beforeEach(() => {
		resetServerConfig();
	});

	it('starts with null config', () => {
		expect(serverConfig.config).toBeNull();
	});

	it('stores config via setServerConfig', () => {
		const config: VircConfig = {
			name: 'Test Server',
			description: 'A test server',
		};
		setServerConfig(config);
		expect(serverConfig.config).toEqual(config);
	});

	it('exposes all VircConfig fields', () => {
		const config: VircConfig = {
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

	it('stores roles field from virc.json', () => {
		const config: VircConfig = {
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
});
