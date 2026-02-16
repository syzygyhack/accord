import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { appSettings, resetAppSettings, SIDEBAR_MIN, SIDEBAR_MAX, SIDEBAR_DEFAULT, MEMBER_MIN, MEMBER_MAX, MEMBER_DEFAULT } from './appSettings.svelte';

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

describe('appSettings', () => {
	beforeEach(() => {
		vi.stubGlobal('localStorage', createStorageMock());
		resetAppSettings();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	describe('systemMessageDisplay', () => {
		it('defaults to smart', () => {
			expect(appSettings.systemMessageDisplay).toBe('smart');
		});

		it('can be set to all', () => {
			appSettings.systemMessageDisplay = 'all';
			expect(appSettings.systemMessageDisplay).toBe('all');
		});

		it('can be set to none', () => {
			appSettings.systemMessageDisplay = 'none';
			expect(appSettings.systemMessageDisplay).toBe('none');
		});

		it('persists to localStorage', () => {
			appSettings.systemMessageDisplay = 'smart';
			const stored = JSON.parse(localStorage.getItem('virc:appSettings')!);
			expect(stored.systemMessageDisplay).toBe('smart');
		});

		it('resets to default', () => {
			appSettings.systemMessageDisplay = 'none';
			resetAppSettings();
			expect(appSettings.systemMessageDisplay).toBe('smart');
		});
	});

	describe('zoom', () => {
		it('defaults to 125', () => {
			expect(appSettings.zoom).toBe(125);
		});

		it('persists to localStorage', () => {
			appSettings.zoom = 100;
			const stored = JSON.parse(localStorage.getItem('virc:appSettings')!);
			expect(stored.zoom).toBe(100);
		});
	});

	describe('showRawIrc', () => {
		it('defaults to false', () => {
			expect(appSettings.showRawIrc).toBe(false);
		});

		it('can be toggled on', () => {
			appSettings.showRawIrc = true;
			expect(appSettings.showRawIrc).toBe(true);
		});

		it('persists to localStorage', () => {
			appSettings.showRawIrc = true;
			const stored = JSON.parse(localStorage.getItem('virc:appSettings')!);
			expect(stored.showRawIrc).toBe(true);
		});

		it('resets to default', () => {
			appSettings.showRawIrc = true;
			resetAppSettings();
			expect(appSettings.showRawIrc).toBe(false);
		});
	});

	describe('developerMode', () => {
		it('defaults to false', () => {
			expect(appSettings.developerMode).toBe(false);
		});

		it('can be toggled on', () => {
			appSettings.developerMode = true;
			expect(appSettings.developerMode).toBe(true);
		});

		it('persists to localStorage', () => {
			appSettings.developerMode = true;
			const stored = JSON.parse(localStorage.getItem('virc:appSettings')!);
			expect(stored.developerMode).toBe(true);
		});

		it('resets to default', () => {
			appSettings.developerMode = true;
			resetAppSettings();
			expect(appSettings.developerMode).toBe(false);
		});
	});

	describe('sidebarWidth', () => {
		it('defaults to 240', () => {
			expect(appSettings.sidebarWidth).toBe(SIDEBAR_DEFAULT);
		});

		it('accepts valid values', () => {
			appSettings.sidebarWidth = 300;
			expect(appSettings.sidebarWidth).toBe(300);
		});

		it('clamps below minimum', () => {
			appSettings.sidebarWidth = 100;
			expect(appSettings.sidebarWidth).toBe(SIDEBAR_MIN);
		});

		it('clamps above maximum', () => {
			appSettings.sidebarWidth = 500;
			expect(appSettings.sidebarWidth).toBe(SIDEBAR_MAX);
		});

		it('persists to localStorage', () => {
			appSettings.sidebarWidth = 280;
			const stored = JSON.parse(localStorage.getItem('virc:appSettings')!);
			expect(stored.sidebarWidth).toBe(280);
		});

		it('resets to default', () => {
			appSettings.sidebarWidth = 300;
			resetAppSettings();
			expect(appSettings.sidebarWidth).toBe(SIDEBAR_DEFAULT);
		});

		it('handles non-number values on load', () => {
			localStorage.setItem('virc:appSettings', JSON.stringify({ sidebarWidth: 'garbage' }));
			resetAppSettings();
			expect(appSettings.sidebarWidth).toBe(SIDEBAR_DEFAULT);
		});
	});

	describe('memberListWidth', () => {
		it('defaults to 240', () => {
			expect(appSettings.memberListWidth).toBe(MEMBER_DEFAULT);
		});

		it('accepts valid values', () => {
			appSettings.memberListWidth = 250;
			expect(appSettings.memberListWidth).toBe(250);
		});

		it('clamps below minimum', () => {
			appSettings.memberListWidth = 100;
			expect(appSettings.memberListWidth).toBe(MEMBER_MIN);
		});

		it('clamps above maximum', () => {
			appSettings.memberListWidth = 400;
			expect(appSettings.memberListWidth).toBe(MEMBER_MAX);
		});

		it('persists to localStorage', () => {
			appSettings.memberListWidth = 220;
			const stored = JSON.parse(localStorage.getItem('virc:appSettings')!);
			expect(stored.memberListWidth).toBe(220);
		});

		it('resets to default', () => {
			appSettings.memberListWidth = 280;
			resetAppSettings();
			expect(appSettings.memberListWidth).toBe(MEMBER_DEFAULT);
		});
	});
});
